import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { approvedContext } from "./approved-context";
import { digest } from "./approval-policy";
import { assertAmazonScopeAdmin } from "./data-access";
import { previewFieldArchiveRecovery } from "./field-archive-recovery";
import { registerArchivedFields } from "./field-registry";
import { orderParserVersion, orderFactSchemaVersion, parseOrderDetail, parseOrderSyncPolicy } from "./orders";
import { SyncInputError, type SyncScope } from "./policy";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("订单原件身份结构无效。", 409);
  return value as Record<string, unknown>;
}
const columns = ["fulfilledBy", "fulfillmentServiceLevel"] as const;

type RecoverySource = Awaited<ReturnType<typeof previewFieldArchiveRecovery>>["source"];
type RecoveryTask = Awaited<ReturnType<typeof previewFieldArchiveRecovery>>["task"];
function assertRecoveryTask(source: RecoverySource, task: RecoveryTask) {
  const frozen = object(task.frozenScope);
  if (source.resource !== "orders" || task.resource !== "orders" || task.status !== "SUCCEEDED" || !task.finishedAt
    || frozen.resource !== "orders" || frozen.authorizationId !== source.authorizationId || frozen.sellerAccountId !== source.sellerAccountId
    || frozen.marketplaceId !== source.marketplaceId || frozen.amazonSellerId !== source.authorization.amazonSellerId
    || frozen.region !== source.authorization.awsRegion || !parseOrderSyncPolicy(frozen.orderPolicy).details) throw new SyncInputError("仅可补齐同账号、同站点、已完成订单任务的详情原件。", 409);
}
async function recoveryTask(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string) {
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId }, select: { id: true, revision: true, resource: true, sellerAccountId: true, marketplaceId: true, authorizationId: true, authorization: { select: { revision: true, amazonSellerId: true, awsRegion: true } } } });
  const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, sourceId, resource: "orders", executionVersion: 2 } });
  if (!source || !task) throw new SyncInputError("订单原件任务不可访问。", 403);
  assertRecoveryTask(source, task);
  return { source, task };
}
function recoveryParams(params: URLSearchParams) {
  const sourceId = params.get("sourceId"), taskId = params.get("taskId");
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || ["sourceId", "taskId"].some(key => params.getAll(key).length !== 1)) throw new SyncInputError("须指定唯一订单来源和任务。");
  return { sourceId, taskId };
}

/** Metadata-only bounded discovery; page numbers are physical and may be sparse. */
export async function readOrderFulfillmentRecoveryPages(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const { sourceId, taskId } = recoveryParams(params), after = params.get("after") ?? "0";
  if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)) || Number(after) > 2147483647 || params.getAll("after").length > 1) throw new SyncInputError("原件分页游标无效。");
  const result = await prisma.$transaction(async tx => {
    const { source } = await recoveryTask(tx, scope, sourceId, taskId);
    const rows = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId, resource: "orders", page: { gt: Number(after) }, AND: [
      { requestMetadata: { path: ["operation"], equals: "getOrder" } }, { requestMetadata: { path: ["apiVersion"], equals: "2026-01-01" } },
      { requestMetadata: { path: ["marketplaceId"], equals: source.marketplaceId } },
    ] }, select: { page: true }, orderBy: { page: "asc" }, take: 11 });
    const pages = rows.slice(0, 10).map(row => row.page);
    return { pages, nextCursor: rows.length > 10 ? pages.at(-1)! : null, hasNext: rows.length > 10, batchSize: 10, started: false, rawValuesIncluded: false };
  });
  await assertAmazonScopeAdmin(scope, actor);
  return result;
}

export async function readOrderFulfillmentRecoveryHistory(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const { sourceId, taskId } = recoveryParams(params);
  const result = await prisma.$transaction(async tx => {
    await recoveryTask(tx, scope, sourceId, taskId);
    const rows = await tx.amazonDataCenterChangeRequest.findMany({ where: { ...scope, operation: "recover-report", targetId: sourceId, AND: [
      { beforeSummary: { path: ["current", "mode"], equals: "ORDER_FULFILLMENT_FILL_MISSING_ONLY" } },
      { beforeSummary: { path: ["current", "taskId"], equals: taskId } }, { beforeSummary: { path: ["current", "sourceId"], equals: sourceId } },
    ] }, select: { id: true, status: true, beforeSummary: true, expiresAt: true, appliedAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 });
    return { batches: rows.slice(0, 20).map(row => {
      const manifest = object(object(row.beforeSummary).current);
      const archives = Array.isArray(manifest.archives) ? manifest.archives : [];
      const pages = archives.map(archive => object(archive).page);
      if (!pages.length || pages.length > 10 || pages.some(page => !Number.isSafeInteger(page) || Number(page) < 1)) throw new SyncInputError("订单补齐批次原件页无效。", 409);
      return { id: row.id, status: ["REQUESTED", "APPROVED"].includes(row.status) && row.expiresAt.getTime() <= Date.now() ? "EXPIRED" : row.status,
        appliedAt: row.appliedAt?.toISOString() ?? null, pages: pages as number[], changedRows: typeof manifest.changedRows === "number" ? manifest.changedRows : null };
    }), hasMore: rows.length > 20, started: false, rawValuesIncluded: false };
  });
  await assertAmazonScopeAdmin(scope, actor);
  return result;
}


/** Reparse immutable getOrder originals. Only null fields on the exact existing
 * detail version can be filled; list heads, detail hashes and cursors stay intact. */
export async function previewOrderFulfillmentRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string, pages: unknown) {
  const scan = await previewFieldArchiveRecovery(tx, scope, sourceId, taskId, pages);
  const { source, task } = scan, frozen = object(task.frozenScope);
  assertRecoveryTask(source, task);
  const policy = parseOrderSyncPolicy(frozen.orderPolicy);
  if (!policy.details) throw new SyncInputError("原任务未启用订单详情。", 409);
  const policyDigest = digest(policy.details);
  const seen = new Set<string>();
  const candidates = [];
  for (const archive of scan.archives) {
    const metadata = object(archive.raw.requestMetadata);
    if (archive.format !== "JSON" || archive.raw.page < 1 || metadata.operation !== "getOrder" || metadata.apiVersion !== "2026-01-01"
      || metadata.marketplaceId !== source.marketplaceId || metadata.policyDigest !== policyDigest
      || !Array.isArray(metadata.includedData) || digest(metadata.includedData) !== digest(policy.details.includedData) || typeof metadata.orderId !== "string" || typeof metadata.listedUpdatedAt !== "string"
      || !Number.isFinite(Date.parse(metadata.listedUpdatedAt))) throw new SyncInputError("订单详情原件操作、策略或站点不匹配。", 409);
    if (seen.has(metadata.orderId)) throw new SyncInputError("一次补齐不能包含同一订单的多个详情原件。", 409);
    seen.add(metadata.orderId);
    const body = JSON.parse(archive.text);
    const parsed = parseOrderDetail(body, metadata.orderId, source.marketplaceId, policy, new Date(metadata.listedUpdatedAt));
    const row = await tx.amazonOrderRecord.findFirst({ where: { ...scope, sourceId, sellerAccountId: source.sellerAccountId,
      marketplaceId: source.marketplaceId, amazonOrderId: metadata.orderId, amazonSellerId: source.authorization.amazonSellerId! } });
    if (!row || row.detailHash !== digest(body) || row.detailPolicyDigest !== policyDigest
      || row.detailsUpdatedAt?.getTime() !== parsed.sourceUpdatedAt.getTime() || row.sourceUpdatedAt.getTime() !== parsed.sourceUpdatedAt.getTime()
      || row.createdTime.getTime() !== parsed.createdTime.getTime()) throw new SyncInputError("原件不匹配当前订单详情版本；不能覆盖后续或过期数据。", 409);
    const additions: Partial<Record<typeof columns[number], string>> = {};
    for (const column of columns) {
      if (parsed[column] === null) continue;
      if (row[column] !== null && row[column] !== parsed[column]) throw new SyncInputError("订单已有履约字段与原件冲突，未覆盖。", 409);
      if (row[column] === null) additions[column] = parsed[column];
    }
    candidates.push({ row, additions, archive });
  }
  const manifest = { ...scan.manifest, mode: "ORDER_FULFILLMENT_FILL_MISSING_ONLY", parserVersion: orderParserVersion, schemaVersion: orderFactSchemaVersion,
    businessFactsModified: candidates.some(item => Object.keys(item.additions).length > 0), checkedRows: candidates.length,
    changedRows: candidates.filter(item => Object.keys(item.additions).length > 0).length,
    addedFields: candidates.reduce((count, item) => count + Object.keys(item.additions).length, 0),
    rows: candidates.map(({ row, additions }) => ({ id: row.id, beforeDigest: digest({ detailHash: row.detailHash, detailPolicyDigest: row.detailPolicyDigest,
      sourceUpdatedAt: row.sourceUpdatedAt, detailsUpdatedAt: row.detailsUpdatedAt, fulfilledBy: row.fulfilledBy, fulfillmentServiceLevel: row.fulfillmentServiceLevel }), additionsDigest: digest(additions) })),
    amazonRequests: 0, cursorsModified: false };
  return { ...scan, candidates, manifest, recoveryDigest: digest(manifest) };
}

export async function readOrderFulfillmentRecoveryPreview(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId"), pages = params.get("rawPages");
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || !pages || !/^\d+(?:,\d+){0,9}$/.test(pages)
    || ["sourceId", "taskId", "rawPages"].some(key => params.getAll(key).length !== 1)) throw new SyncInputError("须指定唯一订单来源、任务和 1–10 个详情原件页。");
  const preview = await prisma.$transaction(tx => previewOrderFulfillmentRecovery(tx, scope, sourceId, taskId, pages.split(",").map(Number)), { timeout: 30000 });
  await assertAmazonScopeAdmin(scope, actor);
  return { manifest: preview.manifest, recoveryDigest: preview.recoveryDigest, started: false, rawValuesIncluded: false,
    command: { action: "recover-report", id: sourceId, revision: preview.source.revision, taskId, rawPages: preview.manifest.archives.map(item => item.page), orderFulfillmentOnly: true, recoveryDigest: preview.recoveryDigest } };
}

export async function applyOrderFulfillmentRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const preview = await previewOrderFulfillmentRecovery(tx, scope, String(command.id), String(command.taskId), command.rawPages);
  if (command.revision !== preview.source.revision || command.recoveryDigest !== preview.recoveryDigest) throw new SyncInputError("订单履约补齐清单或数据版本已变化。", 409);
  for (const { row, additions, archive } of preview.candidates) {
    if (Object.keys(additions).length) {
      const updated = await tx.amazonOrderRecord.updateMany({ where: { ...scope, id: row.id, sourceId: preview.source.id, detailHash: row.detailHash,
        detailPolicyDigest: row.detailPolicyDigest, sourceUpdatedAt: row.sourceUpdatedAt, detailsUpdatedAt: row.detailsUpdatedAt,
        fulfilledBy: row.fulfilledBy, fulfillmentServiceLevel: row.fulfillmentServiceLevel }, data: additions });
      if (updated.count !== 1) throw new SyncInputError("订单详情版本已变化。", 409);
    }
    await registerArchivedFields(tx, preview.task, archive.raw.page, archive.text, "JSON");
  }
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.orders.fulfillment-recovered", entityType: "AmazonSyncDataSource", entityId: preview.source.id,
    metadata: { workspaceId: scope.workspaceId, approvalId, manifest: preview.manifest, recoveryDigest: preview.recoveryDigest } } });
  return { id: preview.source.id, changedRows: preview.manifest.changedRows, addedFields: preview.manifest.addedFields, amazonRequests: 0, cursorsModified: false };
}
