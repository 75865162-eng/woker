import { replicaPageCursorBinding, sealReplicaPageCursor, openReplicaPageCursor } from "./replica-page-cursor";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { amazonAccountReadAccess } from "./read-account";
import { assertAmazonAction } from "./data-access";
import { relayAmazonExecution } from "./cloud-relay";
import { digest } from "./approval-policy";
import { scopeLock } from "./service";
import { requireSyncCenter, SyncInputError, type SyncScope } from "./policy";
import { orderReplicaLimit, orderItemReplicaLimit, orderReplicaSelect, parseOrderReplica, type OrderReplicaRow } from "./order-replica-contract";
function wire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed();
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]));
  return value;
}
export async function exportOrderReplica(scope: SyncScope, actor: string, sourceId: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const params = new URLSearchParams({ sourceId });
  const replica = await prisma.$transaction(async tx => {
    await amazonAccountReadAccess(scope, actor, params, tx, "orders");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "orders", enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    const where = { ...scope, sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId };
    const [orders, itemCount, sourceOrders] = await Promise.all([tx.amazonOrderRecord.count({ where }), tx.amazonOrderItemRecord.count({ where: { ...scope, sourceId, order: where } }), tx.amazonOrderRecord.count({ where: { ...scope, sourceId } })]);
    if (sourceOrders !== orders) throw new SyncInputError("订单来源包含账号或站点绑定冲突，未回传不完整数据。", 409);
    if (orders > orderReplicaLimit || itemCount > orderItemReplicaLimit) throw new SyncInputError("订单或商品明细超过整批回传容量，未返回部分数据。", 409);
    const rows = await tx.amazonOrderRecord.findMany({ where, select: orderReplicaSelect, orderBy: { amazonOrderId: "asc" }, take: orderReplicaLimit + 1 });
    const body = wire({ version: 1, domain: "orders", sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, rows });
    return parseOrderReplica({ ...(body as object), digest: digest(body) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  return replica;
}
/** Each page contains whole orders. Item/byte limits never split or truncate
 * an order, which would make local item reconciliation delete valid details. */
export async function exportOrderReplicaPage(scope: SyncScope, actor: string, sourceId: string, cursor?: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const params = new URLSearchParams({ sourceId });
  const result = await prisma.$transaction(async tx => {
    await amazonAccountReadAccess(scope, actor, params, tx, "orders");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "orders", enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    const where = { ...scope, sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId };
    // PostgreSQL MVCC versions fence every order/item mutation, including updates
    // with unchanged timestamps. Only aggregate fingerprints leave the database.
    const [version] = await tx.$queryRaw<Array<{ total: string; v1: string; v2: string }>>`
      SELECT count(*) FILTER (WHERE kind = 'order')::text AS total,
        COALESCE(sum(hashtextextended(identity, 0)::numeric), 0)::text AS v1,
        COALESCE(sum(hashtextextended(identity, 1)::numeric), 0)::text AS v2
      FROM (
        SELECT 'order' AS kind, 'order:' || id || ':' || xmin::text AS identity FROM "AmazonOrderRecord"
        WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "sourceId" = ${sourceId}
        UNION ALL
        SELECT 'item' AS kind, 'item:' || "orderRecordId" || ':' || "orderItemId" || ':' || xmin::text AS identity FROM "AmazonOrderItemRecord"
        WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "sourceId" = ${sourceId}
      ) versions`;
    const total = Number(version.total);
    if (!Number.isSafeInteger(total) || total !== await tx.amazonOrderRecord.count({ where })) throw new SyncInputError("订单来源包含账号或站点绑定冲突，未回传不完整数据。", 409);
    const generation = digest([source.revision, source.authorizationId, source.authorization.amazonSellerId, source.sellerAccountId, source.marketplaceId, version]);
    const binding = replicaPageCursorBinding(scope, actor, sourceId, source.revision, "orders");
    const progress = cursor === undefined ? null : openReplicaPageCursor(cursor, binding, generation, Date.now(), "orders");
    const candidates = await tx.amazonOrderRecord.findMany({ where: { ...where, ...(progress ? { amazonOrderId: { gt: progress.after } } : {}) }, select: { amazonOrderId: true, _count: { select: { items: true } } }, orderBy: { amazonOrderId: "asc" }, take: orderReplicaLimit + 1 });
    const selected: string[] = []; let selectedItems = 0;
    for (const candidate of candidates.slice(0, orderReplicaLimit)) {
      if (selectedItems + candidate._count.items > orderItemReplicaLimit) {
        if (!selected.length) throw new SyncInputError("单笔订单明细超过回传容量，未拆分或截断业务字段。", 409);
        break;
      }
      selected.push(candidate.amazonOrderId); selectedItems += candidate._count.items;
    }
    const records = await tx.amazonOrderRecord.findMany({ where: { ...where, amazonOrderId: { in: selected } }, select: orderReplicaSelect, orderBy: { amazonOrderId: "asc" } });
    const rows: unknown[] = []; let bytes = 0, items = 0;
    for (const record of records.slice(0, orderReplicaLimit)) {
      const row = wire(record), size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes + size > 440 * 1024 || items + record.items.length > orderItemReplicaLimit) {
        if (!rows.length) throw new SyncInputError("单笔订单或明细超过回传容量，未拆分或截断业务字段。", 409);
        break;
      }
      rows.push(row); bytes += size; items += record.items.length;
    }
    const body = { version: 1, domain: "orders", sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, rows };
    const replica = parseOrderReplica({ ...body, digest: digest(body) });
    const last = replica.rows.at(-1);
    const nextCursor = candidates.length > rows.length && last ? sealReplicaPageCursor({ version: 1, binding, generation, after: last.amazonOrderId, expiresAt: progress?.expiresAt ?? Date.now() + 1800000 }, "orders") : null;
    return { replica, nextCursor, totalRows: total, generation, sourceRevision: source.revision, transferComplete: nextCursor === null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  return result;
}
function base(row: OrderReplicaRow) {
  return { createdTime: row.createdTime, sourceUpdatedAt: row.sourceUpdatedAt, rawStatus: row.rawStatus, normalizedStatus: row.normalizedStatus, marketplaceTimeZone: row.marketplaceTimeZone };
}
function details(row: OrderReplicaRow) {
  return { detailsUpdatedAt: row.detailsUpdatedAt, detailPolicyDigest: row.detailPolicyDigest, fulfilledBy: row.fulfilledBy, fulfillmentServiceLevel: row.fulfillmentServiceLevel, grandTotalOriginal: row.grandTotalOriginal, grandTotalAmount: row.grandTotalAmount, currencyCode: row.currencyCode, items: row.items };
}
export async function publishOrderReplica(scope: SyncScope, actor: string, input: unknown, expected: { sourceId: string; revision: number }) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("订单副本只能发布到本地服务。", 409);
  requireSyncCenter(scope);
  const replica = parseOrderReplica(input);
  if (replica.sourceId !== expected.sourceId) throw new SyncInputError("订单副本来源不匹配。", 409);
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    await assertAmazonAction(scope, actor, "create", tx);
    await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId: replica.sourceId }), tx, "orders");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: replica.sourceId, resource: "orders", enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    if (source.revision !== expected.revision || source.sellerAccountId !== replica.sellerAccountId || source.marketplaceId !== replica.marketplaceId || source.authorization.amazonSellerId !== replica.amazonSellerId) throw new SyncInputError("云端与本地订单绑定或来源版本不一致。", 409);
    const entityId = `order-replica-${digest([scope, source.id, replica.digest])}`;
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.orders.replica.imported", entityId } });
    if (prior) return { sourceId: source.id, rowCount: replica.rows.length, replayed: true, amazonApiCalled: false, completeness: "NON_PII_PAGE_COMMITTED" };
    let inserted = 0, updated = 0, skipped = 0;
    const runs = new Map<string, string>();
    for (const row of replica.rows) {
      const key = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonOrderId: row.amazonOrderId };
      const existing = await tx.amazonOrderRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_amazonOrderId: key }, select: { ...orderReplicaSelect, id: true, sourceId: true, amazonSellerId: true } });
      if (existing && (existing.sourceId !== source.id || existing.amazonSellerId !== replica.amazonSellerId || existing.createdTime.toISOString() !== row.createdTime)) throw new SyncInputError("既有订单来源或创建时间冲突，未覆盖数据。", 409);
      if (existing && existing.sourceUpdatedAt > new Date(row.sourceUpdatedAt)) { skipped++; continue; }
      const existingWire = existing ? wire(existing) as OrderReplicaRow : null;
      if (existingWire && existingWire.sourceUpdatedAt === row.sourceUpdatedAt && digest(base(existingWire)) !== digest(base(row))) throw new SyncInputError("同一订单版本出现冲突，未覆盖本地数据。", 409);
      const takeDetails = !existingWire || row.detailsUpdatedAt !== null && (existingWire.detailsUpdatedAt === null || row.detailsUpdatedAt > existingWire.detailsUpdatedAt);
      if (existingWire && row.detailsUpdatedAt === existingWire.detailsUpdatedAt && digest(details(existingWire)) !== digest(details(row))) throw new SyncInputError("同一订单详情版本出现冲突，未覆盖本地数据。", 409);
      if (existingWire && existingWire.sourceUpdatedAt === row.sourceUpdatedAt && !takeDetails) { skipped++; continue; }
      let runId = runs.get(row.task.id);
      if (!runId) {
        runId = `${entityId}:${digest(row.task.id).slice(0, 16)}`;
        await tx.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId: source.id, requestedByUserId: actor, resource: "orders", mode: "incremental", executionVersion: 2, trigger: "cloud-replica", status: "SUCCEEDED", stage: "REPLICA_PAGE_COMMITTED", finishedAt: new Date(), summary: { cloudTaskId: row.task.id, cloudTaskStatus: row.task.status, cloudTaskStage: row.task.stage, windowCompleteness: "NOT_REPLICATED", nonPiiProjectionOnly: true } } });
        runs.set(row.task.id, runId);
      }
      const baseData = { sourceRunId: runId, amazonSellerId: replica.amazonSellerId, ...base(row), createdTime: new Date(row.createdTime), sourceUpdatedAt: new Date(row.sourceUpdatedAt), capturedAt: new Date(row.capturedAt) };
      const detailData = { ...details(row), detailsUpdatedAt: row.detailsUpdatedAt ? new Date(row.detailsUpdatedAt) : null };
      const { items, ...detailColumns } = detailData;
      // Preserve any existing encrypted source evidence; only safe projection columns change.
      const order = existing
        ? await tx.amazonOrderRecord.update({ where: { id: existing.id }, data: { ...baseData, ...(takeDetails ? detailColumns : {}) } })
        : await tx.amazonOrderRecord.create({ data: { ...key, id: digest(key), sourceId: source.id, ...baseData, ...detailColumns } });
      if (takeDetails) {
        await tx.amazonOrderItemRecord.deleteMany({ where: { ...scope, sourceId: source.id, orderRecordId: order.id } });
        if (items.length) await tx.amazonOrderItemRecord.createMany({ data: items.map(item => ({ ...item, ...scope, sourceId: source.id, orderRecordId: order.id })) });
      }
      if (existing) updated++; else inserted++;
    }
    await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId: source.id }), tx, "orders");
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.orders.replica.imported", entityType: "AmazonSyncDataSource", entityId, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, digest: replica.digest, inserted, updated, skipped } } });
    return { sourceId: source.id, rowCount: replica.rows.length, inserted, updated, skipped, replayed: false, amazonApiCalled: false, completeness: "NON_PII_PAGE_COMMITTED" };
  }, { timeout: 20000 });
}
export async function pullOrderReplica(scope: SyncScope, actor: string, sourceId: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("订单副本只能在本地拉取。", 409);
  requireSyncCenter(scope);
  await assertAmazonAction(scope, actor, "create");
  await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId }), prisma, "orders");
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { revision: true } });
  const result = await relayAmazonExecution(scope, actor, { kind: "orders-replica", sourceId });
  return publishOrderReplica(scope, actor, result.replica, { sourceId, revision: source.revision });
}

export async function pullOrderReplicaPage(scope: SyncScope, actor: string, sourceId: string, cursor?: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("订单副本只能在本地拉取。", 409);
  requireSyncCenter(scope);
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor.length || cursor.length > 2048)) throw new SyncInputError("订单分批回传进度格式无效。", 400);
  await assertAmazonAction(scope, actor, "create");
  await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId }), prisma, "orders");
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { revision: true } });
  const result = await relayAmazonExecution(scope, actor, { kind: "orders-replica-page", sourceId, ...(cursor === undefined ? {} : { cursor }) });
  const replica = parseOrderReplica(result.replica);
  if (result.sourceRevision !== source.revision || !Number.isSafeInteger(result.totalRows) || Number(result.totalRows) < replica.rows.length || typeof result.generation !== "string" || result.transferComplete !== (result.nextCursor === null)) throw new SyncInputError("订单回传进度与来源版本不匹配。", 409);
  const binding = replicaPageCursorBinding(scope, actor, sourceId, source.revision, "orders");
  if (cursor !== undefined) {
    const prior = openReplicaPageCursor(cursor, binding, result.generation, Date.now(), "orders");
    if (replica.rows.some(row => row.amazonOrderId === prior.after)) throw new SyncInputError("订单回传批次未继续原进度。", 409);
  }
  if (result.nextCursor !== null) {
    const next = openReplicaPageCursor(result.nextCursor, binding, result.generation, Date.now(), "orders");
    if (next.after !== replica.rows.at(-1)?.amazonOrderId) throw new SyncInputError("订单回传进度与批次不匹配。", 409);
  }
  const receipt = await publishOrderReplica(scope, actor, replica, { sourceId, revision: source.revision });
  return { ...receipt, nextCursor: result.nextCursor as string | null, totalRows: result.totalRows as number, transferComplete: result.transferComplete as boolean };
}
