import { amazonAccountReadAccess } from "./read-account";
import { orderRecoveryOutcome } from "./orders-recovery";
import { orderProgress, orderProgressEvents } from "./orders-progress";
import { incrementalOperatorAction } from "./read";
import { orderDetailStatusWhere } from "./order-detail-coverage";
import { queryPageSize } from "./query-page";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellerAccessWhere, type AmazonDataAccess } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";
import { digest } from "./approval-policy";

/** Never expose Prisma SQL, database identifiers or connection details to readers. */
export function orderReadFailure(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
    const column = String(error.meta?.column ?? "");
    const fulfillment = error.code === "P2022" && column.split(/[^A-Za-z0-9_]/).some(part => ["fulfilledBy", "fulfillmentServiceLevel"].includes(part));
    throw new SyncInputError(fulfillment
      ? "SCHEMA_UPGRADE_REQUIRED: 订单履约字段尚未迁移，请审核并应用 20261109030000_amazon_order_fulfillment 后重试。"
      : "SCHEMA_UPGRADE_REQUIRED: 订单数据库结构与当前代码不一致，请核对并应用已审核的兼容迁移后重试。", 409);
  }
  throw error;
}

export function orderReadWhere(scope: SyncScope, params: URLSearchParams, access: AmazonDataAccess): Prisma.AmazonOrderRecordWhereInput {
  const filters: Prisma.AmazonOrderRecordWhereInput = {};
  for (const key of ["sellerAccountId", "marketplaceId", "sourceId", "amazonOrderId", "rawStatus"] as const) {
    const value = params.get(key);
    if (value) { if (value.length > 200) throw new SyncInputError("订单筛选长度超限。"); filters[key] = value; }
  }
  for (const key of ["fulfilledBy", "fulfillmentServiceLevel"] as const) {
    const value = params.get(key);
    if (params.getAll(key).length > 1 || value !== null && value.length > 500) throw new SyncInputError("履约字段筛选无效。");
    if (value) filters[key] = value;
  }
  const requestedDateField = params.get("dateField");
  if (requestedDateField && requestedDateField !== "createdTime" && requestedDateField !== "sourceUpdatedAt") throw new SyncInputError("订单日期口径无效。");
  const dateField: "createdTime" | "sourceUpdatedAt" = requestedDateField === "sourceUpdatedAt" ? "sourceUpdatedAt" : "createdTime";
  const dates: { gte?: Date; lt?: Date } = {};
  for (const key of ["from", "to"] as const) {
    const value = params.get(key); if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new SyncInputError("订单日期格式无效。");
    if (key === "from") dates.gte = new Date(value); else dates.lt = new Date(Date.parse(value) + 86400000);
  }
  if (dates.gte && dates.lt && dates.gte >= dates.lt) throw new SyncInputError("订单日期范围无效。");
  if (Object.keys(dates).length) filters[dateField] = dates;
  const sellerSku = params.get("sellerSku"), asin = params.get("asin");
  if (sellerSku || asin || params.get("itemsOnly") === "true") {
    if ((sellerSku?.length ?? 0) > 500 || (asin?.length ?? 0) > 500) throw new SyncInputError("订单商品筛选长度超限。");
    filters.items = { some: { ...(sellerSku ? { sellerSku } : {}), ...(asin ? { asin } : {}) } };
  }
  return { AND: [scope, sellerAccessWhere(access), filters, { source: { resource: "orders" } }] };
}

/** Current non-PII facts are page committed, not immutable run snapshots.
 * Cursor completeness is returned separately. Raw envelopes/tokens never leave this query.
 */
export async function readOrders(scope: SyncScope, params: URLSearchParams, actor?: string) {
  params = new URLSearchParams(params);
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  params.set("sellerAccountId", access.sellerIds[0]);
  const where = orderReadWhere(scope, params, access);
  const dateField: "createdTime" | "sourceUpdatedAt" = params.get("dateField") === "sourceUpdatedAt" ? "sourceUpdatedAt" : "createdTime";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
  const result = await prisma.$transaction(async tx => {
    const sources = await orderSources(tx, scope, params, access);
    const { sourceViews, detailDigests } = orderSourceViews(sources);
    const filteredWhere = { AND: [where, orderDetailStatusWhere(params, detailDigests, tx.amazonOrderRecord.fields.sourceUpdatedAt)] };
    const [total, rows] = await Promise.all([
      tx.amazonOrderRecord.count({ where: filteredWhere }),
      tx.amazonOrderRecord.findMany({ where: filteredWhere, orderBy: [{ [dateField]: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
        select: { amazonOrderId: true, sourceId: true, sourceRunId: true, sellerAccountId: true, marketplaceId: true, createdTime: true, sourceUpdatedAt: true, rawStatus: true, normalizedStatus: true, marketplaceTimeZone: true, capturedAt: true, detailsUpdatedAt: true, fulfilledBy: true, fulfillmentServiceLevel: true, detailPolicyDigest: true, grandTotalOriginal: true, currencyCode: true, items: { select: { orderItemId: true, asin: true, sellerSku: true, quantityOrdered: true, proceedsOriginal: true, currencyCode: true } } } }),
    ]);
    return { rows: rows.map(({ detailPolicyDigest, ...row }) => ({ ...row, detailsCurrent: !!row.detailsUpdatedAt && row.detailsUpdatedAt >= row.sourceUpdatedAt && !!detailPolicyDigest && detailPolicyDigest === detailDigests.get(row.sourceId) })), sources: sourceViews, pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) }, completeness: "PAGE_COMMITTED", detailsComplete: sourceViews.length > 0 && sourceViews.every(s => s.detailsComplete) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }).catch(orderReadFailure);
  await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  return result;
}

async function orderSources(tx: Prisma.TransactionClient, scope: SyncScope, params: URLSearchParams, access: AmazonDataAccess) {
  const sources = await tx.amazonSyncDataSource.findMany({ where: { AND: [{ ...scope, resource: "orders", ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}), ...(params.get("sourceId") ? { id: params.get("sourceId")! } : {}) }, sellerAccessWhere(access)] },
    select: { id: true, enabled: true, marketplaceId: true, orderPolicy: true, coverage: true, seller: { select: { displayName: true } }, resourceCursor: { select: { activeRunId: true, watermarkFrom: true, watermarkTo: true, lastSuccessAt: true, status: true, listComplete: true, detailPolicyDigest: true, updatedAt: true } } }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("订单数据源超过试点容量。", 409);
  const ids = sources.flatMap(source => source.resourceCursor?.activeRunId ? [source.resourceCursor.activeRunId] : []);
  const tasks = ids.length ? await tx.amazonSyncRun.findMany({ where: { ...scope, id: { in: ids }, sourceId: { in: sources.map(source => source.id) }, resource: "orders", executionVersion: 2 },
    select: { id: true, sourceId: true, status: true, stage: true, pagesCompleted: true, detailsCompletedCount: true, attempts: true, maxAttempts: true, apiRequests: true, throttles: true, nextAttemptAt: true, startedAt: true, executionStartedAt: true, updatedAt: true, leaseExpiresAt: true, frozenScope: true, executionApproval: { select: { operation: true, status: true, appliedAt: true, beforeSummary: true, afterSummary: true } },
      logs: { where: { stage: "REQUEST", statusCode: { gte: 400 } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { statusCode: true } } } }) : [];
  const commits = ids.length ? await tx.amazonSyncTaskLog.groupBy({ by: ["taskId"], where: { ...scope, taskId: { in: ids }, event: { in: orderProgressEvents } }, _max: { createdAt: true } }) : [];
  const windows = sources.flatMap(source => {
    const cursor = source.resourceCursor;
    return cursor ? [{ sourceId: source.id, watermarkFrom: cursor.watermarkFrom, watermarkTo: cursor.watermarkTo, policyDigest: cursor.detailPolicyDigest ?? "" }] : [];
  });
  const pending = windows.length ? await tx.amazonOrderDetailWork.groupBy({ by: ["sourceId"], where: { ...scope, status: "PENDING", OR: windows }, _count: { _all: true } }) : [];
  const checkedAt = new Date();
  return sources.map(source => {
    const task = tasks.find(task => task.id === source.resourceCursor?.activeRunId && task.sourceId === source.id);
    if (!task) return { ...source, recoveryTask: null };
    const { logs, executionApproval, frozenScope, leaseExpiresAt, startedAt, executionStartedAt, updatedAt, ...safeTask } = task;
    const progress = orderProgress({ ...safeTask, frozenScope, leaseExpiresAt, startedAt, executionStartedAt, updatedAt }, commits.find(commit => commit.taskId === task.id)?._max.createdAt ?? null, checkedAt);
    const baseline = executionApproval?.beforeSummary as { current?: { orderRecovery?: unknown } } | null;
    const command = executionApproval?.afterSummary as { control?: unknown } | null;
    const recoveryOutcome = executionApproval?.operation === "control-task" && executionApproval.status === "APPLIED" && ["retry", "resume"].includes(String(command?.control))
      ? orderRecoveryOutcome(task, pending.find(item => item.sourceId === source.id)?._count._all ?? 0, baseline?.current?.orderRecovery, executionApproval.appliedAt) : null;
    const failed = ["FAILED", "BLOCKED", "RETRY_WAIT"].includes(task.status);
    return { ...source, recoveryTask: { ...safeTask, progress, recoveryOutcome, lastHttpErrorStatus: failed ? logs[0]?.statusCode ?? null : null,
      operatorAction: incrementalOperatorAction("orders", task.status), canRequestRetry: ["FAILED", "BLOCKED", "PARTIAL_SUCCESS"].includes(task.status),
      failureReason: !failed ? null : task.status === "RETRY_WAIT" ? "请求暂时失败，等待限流退避或有限重试。" : task.status === "BLOCKED" ? "任务执行条件不满足，请核对当前授权、范围及审批。" : task.attempts >= task.maxAttempts ? "自动重试次数已用尽；原件、已提交页和游标保留。" : "请求或数据校验失败，请在任务详情核对日志后申请恢复。" } };
  });
}

function orderSourceViews(sources: Awaited<ReturnType<typeof orderSources>>) {
  if (sources.length > 200) throw new SyncInputError("订单数据源超过试点容量。", 409);
  const sourceViews = sources.map(({ orderPolicy, resourceCursor, coverage, ...source }) => {
    const details = (orderPolicy as Prisma.JsonObject | null)?.details;
    const safeCursor = resourceCursor ? { watermarkFrom: resourceCursor.watermarkFrom, watermarkTo: resourceCursor.watermarkTo, lastSuccessAt: resourceCursor.lastSuccessAt, status: resourceCursor.status, listComplete: resourceCursor.listComplete, updatedAt: resourceCursor.updatedAt } : null;
    const includedData = details && typeof details === "object" && !Array.isArray(details) ? details.includedData : null;
    const proceedsRequested = Array.isArray(includedData) && includedData.includes("PROCEEDS");
    const historical = (coverage as Prisma.JsonObject | null)?.historicalBackfill;
    const historicalBackfill = historical && typeof historical === "object" && !Array.isArray(historical) && historical.enabled === true && typeof historical.selected === "number" && Number.isSafeInteger(historical.selected) && historical.selected >= 0 && typeof historical.deferred === "boolean"
      ? { enabled: true, selected: historical.selected, deferred: historical.deferred } : null;
    const coverageWindow = (coverage as Prisma.JsonObject | null)?.window;
    const window = coverageWindow && typeof coverageWindow === "object" && !Array.isArray(coverageWindow) ? coverageWindow : null;
    const historicalBackfillWindow = historicalBackfill && typeof window?.from === "string" && typeof window.to === "string" && Number.isFinite(Date.parse(window.from)) && Number.isFinite(Date.parse(window.to)) && Date.parse(window.from) < Date.parse(window.to)
      ? { from: window.from, to: window.to } : null;
    const historicalBackfillEnabled = !!details && typeof details === "object" && !Array.isArray(details) && details.backfillExisting === true;
    return { ...source, historicalBackfillEnabled, historicalBackfillWindow, historicalBackfill, resourceCursor: safeCursor, proceedsRequested, detailsEnabled: !!details, detailsComplete: !!details && resourceCursor?.status === "SUCCEEDED" && resourceCursor.detailPolicyDigest === digest(details) };
  });
  const detailDigests = new Map(sources.map(s => { const details = (s.orderPolicy as Prisma.JsonObject | null)?.details; return [s.id, details ? digest(details) : null]; }));

  return { sourceViews, detailDigests };
}

/** Page item records, not parent orders: sibling items never bypass SKU/ASIN filters. */
export async function readOrderItems(scope: SyncScope, params: URLSearchParams, actor?: string) {
  params = new URLSearchParams(params);
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  params.set("sellerAccountId", access.sellerIds[0]);
  const parent = orderReadWhere(scope, params, access);
  const orderItemId = params.get("orderItemId");
  if ((orderItemId?.length ?? 0) > 200) throw new SyncInputError("订单商品筛选长度超限。");
  const itemFilters: Prisma.AmazonOrderItemRecordWhereInput = {
    ...scope,
    ...(params.get("sourceId") ? { sourceId: params.get("sourceId")! } : {}),
    ...(params.get("sellerSku") ? { sellerSku: params.get("sellerSku")! } : {}),
    ...(params.get("asin") ? { asin: params.get("asin")! } : {}),
    ...(orderItemId ? { orderItemId } : {}),
  };
  const dateField = params.get("dateField") === "sourceUpdatedAt" ? "sourceUpdatedAt" : "createdTime";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
  const result = await prisma.$transaction(async tx => {
    const sources = await orderSources(tx, scope, params, access);
    const { sourceViews, detailDigests } = orderSourceViews(sources);
    const where: Prisma.AmazonOrderItemRecordWhereInput = { ...itemFilters, order: { is: { AND: [parent, orderDetailStatusWhere(params, detailDigests, tx.amazonOrderRecord.fields.sourceUpdatedAt)] } } };
    const [total, items] = await Promise.all([
      tx.amazonOrderItemRecord.count({ where }),
      tx.amazonOrderItemRecord.findMany({ where,
        orderBy: [{ order: { [dateField]: "desc" } }, { orderRecordId: "asc" }, { orderItemId: "asc" }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { orderItemId: true, asin: true, sellerSku: true, quantityOrdered: true, proceedsOriginal: true, currencyCode: true,
          order: { select: { amazonOrderId: true, sourceId: true, sourceRunId: true, sellerAccountId: true, marketplaceId: true, createdTime: true, sourceUpdatedAt: true, rawStatus: true, normalizedStatus: true, capturedAt: true, detailsUpdatedAt: true, fulfilledBy: true, fulfillmentServiceLevel: true, detailPolicyDigest: true } } } }),
    ]);
    const rows = items.map(({ order: { detailPolicyDigest, ...order }, ...item }) => ({ ...order, ...item,
      detailsCurrent: !!order.detailsUpdatedAt && order.detailsUpdatedAt >= order.sourceUpdatedAt && !!detailPolicyDigest && detailPolicyDigest === detailDigests.get(order.sourceId) }));
    return { rows, sources: sourceViews, pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) }, completeness: "PAGE_COMMITTED", detailsComplete: sourceViews.length > 0 && sourceViews.every(s => s.detailsComplete) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }).catch(orderReadFailure);
  await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  return result;
}
