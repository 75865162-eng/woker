import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { amazonAccountReadAccess } from "./read-account";
import { assertAmazonAction } from "./data-access";
import { digest } from "./approval-policy";
import { relayAmazonExecution } from "./cloud-relay";
import { inventoryReplicaLimit, inventoryReplicaSelect, catalogReplicaSelect, parseSnapshotReplica, type SnapshotReplica } from "./inventory-replica-contract";
import { amazonBusinessData } from "./business-data";
import { SyncInputError, requireSyncCenter, type SyncScope } from "./policy";

export async function exportSnapshotReplica(scope: SyncScope, actor: string, sourceId: string, resource: "inventory" | "catalog") {
  assertAmazonCloudExecution();
  requireSyncCenter(scope);
  const params = new URLSearchParams({ sourceId });
  const replica = await prisma.$transaction(async tx => {
    await amazonAccountReadAccess(scope, actor, params, tx, resource);
    const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, resource, enabled: true }, include: { publishedRun: true, authorization: { select: { amazonSellerId: true } } } });
    const run = source?.publishedRun;
    if (!source || !run || run.status !== "SUCCEEDED" || run.executionVersion !== 2 || run.resource !== resource || run.sourceId !== source.id || !run.finishedAt || run.stage === "PURGED") throw new SyncInputError("云端尚无完整发布的快照版本。", 409);
    const common = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId };
    const rows = resource === "catalog"
      ? await tx.amazonCatalogSnapshot.findMany({ where: { ...common, sourceRunId: run.id }, select: catalogReplicaSelect, orderBy: { id: "asc" }, take: inventoryReplicaLimit + 1 })
      : await tx.amazonInventorySnapshot.findMany({ where: { ...common, syncRunId: run.id }, select: inventoryReplicaSelect, orderBy: { id: "asc" }, take: inventoryReplicaLimit + 1 });
    const businessRows = resource === "catalog" ? rows.map(row => amazonBusinessData(JSON.parse(JSON.stringify(row)))) : rows;
    if (rows.length > inventoryReplicaLimit) throw new SyncInputError("快照副本超过首版整批容量，未返回不完整数据；需要分批回传能力。", 409);
    const body = JSON.parse(JSON.stringify({ version: 1, sourceId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonSellerId: source.authorization.amazonSellerId, cloudRunId: run.id, publishedAt: run.finishedAt.toISOString(), ...(resource === "catalog" ? { resource } : {}), rows: businessRows }));
    return parseSnapshotReplica({ ...body, digest: digest(body) }, resource);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, resource);
  return replica;
}

/** Import a complete, versioned business snapshot. Never imports credentials,
 * approval grants, queue leases or worker checkpoints from the executor.
 */
export async function publishSnapshotReplica(scope: SyncScope, actor: string, input: unknown, expected: { sourceId: string; activeRunId: string | null; revision: number }, resource: "inventory" | "catalog") {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("云端不能导入本地快照副本。", 409);
  requireSyncCenter(scope);
  const replica = parseSnapshotReplica(input, resource);
  if (replica.sourceId !== expected.sourceId) throw new SyncInputError("快照副本来源不匹配。", 409);
  const params = new URLSearchParams({ sourceId: replica.sourceId });
  return prisma.$transaction(async tx => {
    await assertAmazonAction(scope, actor, "create", tx);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "AmazonSyncDataSource" WHERE id = ${replica.sourceId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR UPDATE`);
    await amazonAccountReadAccess(scope, actor, params, tx, resource);
    const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: replica.sourceId, resource, enabled: true }, include: { authorization: { select: { amazonSellerId: true } } } });
    if (!source || source.sellerAccountId !== replica.sellerAccountId || source.marketplaceId !== replica.marketplaceId || source.authorization.amazonSellerId !== replica.amazonSellerId) throw new SyncInputError("云端与本地账号、站点或官方卖家绑定不一致。", 409);
    const runId = `replica-${digest([scope, replica.sourceId, replica.cloudRunId])}`;
    const existing = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: runId } });
    if (existing && (existing.sourceId !== source.id || (existing.summary as { replicaDigest?: string } | null)?.replicaDigest !== replica.digest || existing.status !== "SUCCEEDED")) throw new SyncInputError("同一云端版本的副本内容发生变化。", 409);
    if (source.activeRunId === runId && existing) return receipt(replica, runId, true);
    if (source.revision !== expected.revision || source.activeRunId !== expected.activeRunId) throw new SyncInputError("本地来源或发布版本已变化，请重新拉取副本。", 409);
    if (source.lastSuccessAt && source.lastSuccessAt >= new Date(replica.publishedAt)) throw new SyncInputError("云端版本未晚于本地已发布版本，拒绝覆盖。", 409);
    if (!existing) {
      await tx.amazonSyncRun.create({ data: { ...scope, id: runId, sourceId: source.id, requestedByUserId: actor, resource, executionVersion: 2, trigger: "cloud-replica", status: "SUCCEEDED", stage: "REPLICA_PUBLISHED", paginationComplete: true, processedCount: replica.rows.length, insertedCount: replica.rows.length, finishedAt: new Date(replica.publishedAt), summary: { cloudRunId: replica.cloudRunId, replicaDigest: replica.digest, snapshotResource: resource } } });
      if ("resource" in replica) {
        if (replica.rows.length) await tx.amazonCatalogSnapshot.createMany({ data: replica.rows.map((row, index) => ({ ...row, ...scope, id: `${runId}:${index}`, sourceRunId: runId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, listingAttributes: row.listingAttributes === null ? Prisma.DbNull : row.listingAttributes, fieldSources: row.fieldSources === null ? Prisma.JsonNull : row.fieldSources, capturedAt: new Date(row.capturedAt), createdAt: new Date(row.createdAt), sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null })) });
      } else if (replica.rows.length) await tx.amazonInventorySnapshot.createMany({ data: replica.rows.map((row, index) => ({ ...row, ...scope, id: `${runId}:${index}`, syncRunId: runId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, capturedAt: new Date(row.capturedAt), createdAt: new Date(row.createdAt), sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null })) });
    }
    await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: runId, lastSuccessAt: new Date(replica.publishedAt), rowCount: replica.rows.length } });
    await amazonAccountReadAccess(scope, actor, params, tx, resource);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.${resource}.replica.published`, entityType: "AmazonSyncRun", entityId: runId, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, cloudRunId: replica.cloudRunId, digest: replica.digest, rowCount: replica.rows.length } } });
    return receipt(replica, runId, false);
  });
}
function receipt(replica: SnapshotReplica, runId: string, replayed: boolean) {
  return { sourceId: replica.sourceId, cloudRunId: replica.cloudRunId, localRunId: runId, rowCount: replica.rows.length, publishedAt: replica.publishedAt, replayed, scope: "resource" in replica ? "structured-catalog" as const : "structured-inventory" as const, amazonApiCalled: false };
}
export async function pullSnapshotReplica(scope: SyncScope, actor: string, sourceId: string, resource: "inventory" | "catalog") {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("快照副本拉取只允许在本地服务执行。", 409);
  requireSyncCenter(scope);
  await assertAmazonAction(scope, actor, "create");
  await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sourceId }), prisma, resource);
  const source = await prisma.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId }, select: { activeRunId: true, revision: true } });
  const result = await relayAmazonExecution(scope, actor, { kind: resource === "catalog" ? "catalog-replica" : "inventory-replica", sourceId });
  return publishSnapshotReplica(scope, actor, result.replica, { sourceId, ...source }, resource);
}

// Keep the existing inventory service contract while sharing publication logic.
export const exportInventoryReplica = (scope: SyncScope, actor: string, sourceId: string) => exportSnapshotReplica(scope, actor, sourceId, "inventory");
export const publishInventoryReplica = (scope: SyncScope, actor: string, input: unknown, expected: { sourceId: string; activeRunId: string | null; revision: number }) => publishSnapshotReplica(scope, actor, input, expected, "inventory");
export const pullInventoryReplica = (scope: SyncScope, actor: string, sourceId: string) => pullSnapshotReplica(scope, actor, sourceId, "inventory");
