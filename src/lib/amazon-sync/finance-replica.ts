import { financeReplicaCursorBinding, sealFinanceReplicaCursor, openFinanceReplicaCursor } from "./finance-replica-cursor";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { amazonAccountReadAccess } from "./read-account";
import { assertAmazonAction } from "./data-access";
import { relayAmazonExecution } from "./cloud-relay";
import { digest } from "./approval-policy";
import { amazonBusinessData } from "./business-data";
import { scopeLock } from "./service";
import { requireSyncCenter, SyncInputError, type SyncScope } from "./policy";
import { financeReplicaLimit, financeReplicaSelect, parseFinanceReplica, type FinanceReplicaRow } from "./finance-replica-contract";
function wire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed();
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]));
  return value;
}
function projection(row: FinanceReplicaRow) {
  const { task, capturedAt, ...data } = Object.fromEntries(Object.keys(financeReplicaSelect).map(key => [key, row[key as keyof FinanceReplicaRow]])) as FinanceReplicaRow;
  void task; void capturedAt;
  return { ...data, fxEvidence: amazonBusinessData(data.fxEvidence) };
}
export async function exportFinanceReplica(scope: SyncScope, actor: string, sourceId: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const params = new URLSearchParams({ sourceId });
  const replica = await prisma.$transaction(async tx => {
    await amazonAccountReadAccess(scope, actor, params, tx, "finance");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "finance", enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    // Finance is seller-wide: the source's administrative site is not a row filter.
    const where = { ...scope, sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId };
    const [count, total] = await Promise.all([tx.amazonFinanceRecord.count({ where }), tx.amazonFinanceRecord.count({ where: { ...scope, sourceId } })]);
    if (count !== total) throw new SyncInputError("财务来源包含账号绑定冲突，未回传不完整数据。", 409);
    if (count > financeReplicaLimit) throw new SyncInputError("财务记录超过整批回传容量，未返回部分数据。", 409);
    const records = await tx.amazonFinanceRecord.findMany({ where, select: financeReplicaSelect, orderBy: { transactionId: "asc" }, take: financeReplicaLimit + 1 });
    const rows = records.map(row => ({ ...row, fxEvidence: amazonBusinessData(row.fxEvidence) }));
    const body = wire({ version: 1, domain: "finance", sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, rows });
    return parseFinanceReplica({ ...(body as object), digest: digest(body) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, "finance");
  return replica;
}
/** One bounded page per request. A changing cloud generation requires a fresh
 * pass, rather than silently skipping facts that move behind the keyset. */
export async function exportFinanceReplicaPage(scope: SyncScope, actor: string, sourceId: string, cursor?: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const params = new URLSearchParams({ sourceId });
  const result = await prisma.$transaction(async tx => {
    await amazonAccountReadAccess(scope, actor, params, tx, "finance");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "finance", enabled: true }, include: { authorization: { select: { amazonSellerId: true } }, resourceCursor: { select: { captureSequence: true } } } });
    const where = { ...scope, sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId };
    const [aggregate, total] = await Promise.all([
      tx.amazonFinanceRecord.aggregate({ where, _count: true, _max: { observationSequence: true, capturedAt: true } }),
      tx.amazonFinanceRecord.count({ where: { ...scope, sourceId } }),
    ]);
    if (total !== aggregate._count) throw new SyncInputError("财务来源包含账号绑定冲突，未回传不完整数据。", 409);
    const generation = digest([source.revision, source.authorizationId, source.authorization.amazonSellerId, source.sellerAccountId, source.marketplaceId, source.resourceCursor?.captureSequence ?? null, aggregate._count, aggregate._max.observationSequence, aggregate._max.capturedAt?.toISOString() ?? null]);
    const binding = financeReplicaCursorBinding(scope, actor, sourceId, source.revision);
    const progress = cursor === undefined ? null : openFinanceReplicaCursor(cursor, binding, generation);
    const records = await tx.amazonFinanceRecord.findMany({ where: { ...where, ...(progress ? { transactionId: { gt: progress.after } } : {}) }, select: financeReplicaSelect, orderBy: { transactionId: "asc" }, take: financeReplicaLimit + 1 });
    // Bound bytes as well as rows, so large legitimate evidence objects can be
    // continued in another page without dropping fields or truncating a row.
    const rows: unknown[] = []; let bytes = 0;
    for (const record of records.slice(0, financeReplicaLimit)) {
      const row = wire({ ...record, fxEvidence: amazonBusinessData(record.fxEvidence) });
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes + size > 440 * 1024) {
        if (!rows.length) throw new SyncInputError("单条财务记录超过回传容量，未截断业务字段。", 409);
        break;
      }
      rows.push(row); bytes += size;
    }
    const body = { version: 1, domain: "finance", sourceId, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, rows };
    const replica = parseFinanceReplica({ ...body, digest: digest(body) });
    const last = replica.rows.at(-1);
    const nextCursor = records.length > rows.length && last ? sealFinanceReplicaCursor({ version: 1, binding, generation, after: last.transactionId, expiresAt: progress?.expiresAt ?? Date.now() + 1800000 }) : null;
    return { replica, nextCursor, totalRows: total, generation, sourceRevision: source.revision, transferComplete: nextCursor === null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, "finance");
  return result;
}
export async function publishFinanceReplica(scope: SyncScope, actor: string, input: unknown, expected: { sourceId: string; revision: number }) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("财务副本只能发布到本地服务。", 409);
  requireSyncCenter(scope);
  const replica = parseFinanceReplica(input);
  if (replica.sourceId !== expected.sourceId) throw new SyncInputError("财务副本来源不匹配。", 409);
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    await assertAmazonAction(scope, actor, "create", tx);
    await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId: replica.sourceId }), tx, "finance");
    const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: replica.sourceId, resource: "finance", enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    if (source.revision !== expected.revision || source.sellerAccountId !== replica.sellerAccountId || source.marketplaceId !== replica.marketplaceId || source.authorization.amazonSellerId !== replica.amazonSellerId) throw new SyncInputError("云端与本地财务绑定或来源版本不一致。", 409);
    const entityId = `finance-replica-${digest([scope, source.id, replica.digest])}`;
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.finance.replica.imported", entityId } });
    let inserted = 0, updated = 0, skipped = 0;
    const runs = new Map<string, string>();
    for (const row of replica.rows) {
      const key = { ...scope, sellerAccountId: source.sellerAccountId, transactionId: row.transactionId };
      const existing = await tx.amazonFinanceRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_transactionId: key }, select: { ...financeReplicaSelect, id: true, sourceId: true, amazonSellerId: true } });
      if (existing && (existing.sourceId !== source.id || existing.amazonSellerId !== replica.amazonSellerId)) throw new SyncInputError("既有财务来源或卖家身份冲突，未覆盖数据。", 409);
      if (existing && existing.observationSequence > row.observationSequence) { skipped++; continue; }
      if (existing && existing.observationSequence === row.observationSequence) {
        if (digest(projection(wire(existing) as FinanceReplicaRow)) !== digest(projection(row))) throw new SyncInputError("同一财务观察版本出现冲突，未覆盖本地数据。", 409);
        skipped++; continue;
      }
      if (existing?.attributionStatus === "ATTRIBUTED" && row.attributionStatus === "QUARANTINED") throw new SyncInputError("隔离记录不能覆盖已正确归属的财务记录。", 409);
      let runId = runs.get(row.task.id);
      if (!runId) {
        runId = `${entityId}:${digest(row.task.id).slice(0, 16)}`;
        await tx.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId: source.id, requestedByUserId: actor, resource: "finance", mode: "incremental", executionVersion: 2, trigger: "cloud-replica", status: "SUCCEEDED", stage: "REPLICA_PAGE_COMMITTED", finishedAt: new Date(), summary: { cloudTaskId: row.task.id, cloudTaskStatus: row.task.status, cloudTaskStage: row.task.stage, windowCompleteness: "NOT_REPLICATED", quarantineCiphertextReplicated: false } } });
        runs.set(row.task.id, runId);
      }
      const data = { ...projection(row), ...key, sourceRunId: runId, amazonSellerId: replica.amazonSellerId, sourceId: source.id, postedAt: new Date(row.postedAt), capturedAt: new Date(row.capturedAt), fxEvidence: row.fxEvidence === null ? Prisma.DbNull : row.fxEvidence as Prisma.InputJsonValue };
      if (existing) await tx.amazonFinanceRecord.update({ where: { id: existing.id }, data });
      else await tx.amazonFinanceRecord.create({ data: { id: digest(key), ...data } });
      // Existing encrypted evidence remains untouched; it is never sent over this bridge.
      if (existing) updated++; else inserted++;
    }
    await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId: source.id }), tx, "finance");
    if (!prior) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.finance.replica.imported", entityType: "AmazonSyncDataSource", entityId, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, digest: replica.digest, inserted, updated, skipped } } });
    return { sourceId: source.id, rowCount: replica.rows.length, inserted, updated, skipped, replayed: !!prior, amazonApiCalled: false, completeness: "PAGE_COMMITTED", financialFinal: false, quarantineCiphertextReplicated: false };
  }, { timeout: 20000 });
}
export async function pullFinanceReplica(scope: SyncScope, actor: string, sourceId: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("财务副本只能在本地拉取。", 409);
  requireSyncCenter(scope);
  await assertAmazonAction(scope, actor, "create");
  await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId }), prisma, "finance");
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { revision: true } });
  const result = await relayAmazonExecution(scope, actor, { kind: "finance-replica", sourceId });
  return publishFinanceReplica(scope, actor, result.replica, { sourceId, revision: source.revision });
}

export async function pullFinanceReplicaPage(scope: SyncScope, actor: string, sourceId: string, cursor?: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("财务副本只能在本地拉取。", 409);
  requireSyncCenter(scope);
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor.length || cursor.length > 2048)) throw new SyncInputError("财务分批回传进度格式无效。", 400);
  await assertAmazonAction(scope, actor, "create");
  await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId }), prisma, "finance");
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { revision: true } });
  const result = await relayAmazonExecution(scope, actor, { kind: "finance-replica-page", sourceId, ...(cursor === undefined ? {} : { cursor }) });
  const replica = parseFinanceReplica(result.replica);
  if (result.sourceRevision !== source.revision || !Number.isSafeInteger(result.totalRows) || Number(result.totalRows) < replica.rows.length || typeof result.generation !== "string" || result.transferComplete !== (result.nextCursor === null)) throw new SyncInputError("财务回传进度与来源版本不匹配。", 409);
  if (cursor !== undefined) {
    const prior = openFinanceReplicaCursor(cursor, financeReplicaCursorBinding(scope, actor, sourceId, source.revision), result.generation);
    if (replica.rows.some(row => row.transactionId === prior.after)) throw new SyncInputError("财务回传批次未继续原进度。", 409);
  }
  if (result.nextCursor !== null) {
    const next = openFinanceReplicaCursor(result.nextCursor, financeReplicaCursorBinding(scope, actor, sourceId, source.revision), result.generation);
    if (next.after !== replica.rows.at(-1)?.transactionId) throw new SyncInputError("财务回传进度与批次不匹配。", 409);
  }
  const receipt = await publishFinanceReplica(scope, actor, replica, { sourceId, revision: source.revision });
  return { ...receipt, nextCursor: result.nextCursor as string | null, totalRows: result.totalRows as number, transferComplete: result.transferComplete as boolean };
}
