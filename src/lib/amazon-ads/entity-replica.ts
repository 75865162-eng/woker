import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import { relayAmazonExecution } from "@/lib/amazon-sync/cloud-relay";
import { requireSyncCenter, SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";
import { amazonAdsAccountReadAccess } from "./read-access";
import { adsEntityReplicaLimit, adsEntityReplicaSelect, adsReplicaVersion, parseAdsEntityReplica, type AdsEntityReplica } from "./entity-replica-contract";

async function profileFingerprint(db: Prisma.TransactionClient, scope: SyncScope, profileId: string) {
  const profile = await db.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: profileId } });
  const rows = await db.amazonAdsEntityRecord.findMany({ where: { ...scope, profileId }, select: { ...adsEntityReplicaSelect, sourceTaskId: true }, orderBy: [{ entityType: "asc" }, { externalId: "asc" }], take: adsEntityReplicaLimit + 1 });
  if (rows.length > adsEntityReplicaLimit) throw new SyncInputError("本地广告对象超过整批回传容量，未修改数据。", 409);
  return digest({ profile: { id: profile.id, updatedAt: profile.updatedAt.toISOString() }, rows: JSON.parse(JSON.stringify(rows)) });
}
export async function exportAdsEntityReplica(scope: SyncScope, actor: string, profileRecordId: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const replica = await prisma.$transaction(async tx => {
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId }, tx);
    const profile = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: profileRecordId } });
    const active = await tx.amazonAdsSyncTask.count({ where: { ...scope, profileId: profileRecordId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } } });
    if (active) throw new SyncInputError("广告对象同步尚未结束，保留当前本地数据后再试。", 409);
    const rows = await tx.amazonAdsEntityRecord.findMany({ where: { ...scope, profileId: profileRecordId }, select: adsEntityReplicaSelect, orderBy: [{ entityType: "asc" }, { externalId: "asc" }], take: adsEntityReplicaLimit + 1 });
    if (rows.length > adsEntityReplicaLimit) throw new SyncInputError("广告对象超过整批回传容量，未返回不完整对象集。", 409);
    if (!rows.length) {
      const latest = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, profileId: profileRecordId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { status: true, stage: true, finishedAt: true } });
      if (latest?.status !== "SUCCEEDED" || latest.stage !== "COMPLETED_SP_STRUCTURE" || !latest.finishedAt) throw new SyncInputError("当前 Profile 尚无已完成的广告对象同步，不能将缺失数据作为空快照。", 409);
    }
    const safeRows = rows.map(row => ({ ...row, payload: amazonBusinessData(row.payload), targetingExpression: row.targetingExpression === null ? null : amazonBusinessData(row.targetingExpression) }));
    const body = JSON.parse(JSON.stringify({ version: 1, domain: "ads-entities", profileRecordId, amazonProfileId: profile.profileId, sellerAccountId: profile.sellerAccountId, marketplaceId: profile.marketplaceId, region: profile.region, currencyCode: profile.currencyCode, timezone: profile.timezone, exportedAt: new Date().toISOString(), rows: safeRows }));
    return parseAdsEntityReplica({ ...body, digest: digest(body) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAdsAccountReadAccess(scope, actor, { profileRecordId });
  return replica;
}
export async function publishAdsEntityReplica(scope: SyncScope, actor: string, input: unknown, expected: { profileRecordId: string; fingerprint: string }) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("广告副本仅允许发布到本地服务。", 409);
  requireSyncCenter(scope);
  const replica = parseAdsEntityReplica(input);
  if (replica.profileRecordId !== expected.profileRecordId) throw new SyncInputError("广告副本 Profile 不匹配。", 409);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "AmazonAdsProfile" WHERE id = ${replica.profileRecordId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR UPDATE`);
    await assertAmazonAction(scope, actor, "create", tx);
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId: replica.profileRecordId }, tx);
    const profile = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: replica.profileRecordId }, include: { authorization: { select: { revision: true } } } });
    if (profile.sellerAccountId !== replica.sellerAccountId || profile.profileId !== replica.amazonProfileId || profile.marketplaceId !== replica.marketplaceId || profile.region !== replica.region || profile.currencyCode !== replica.currencyCode || profile.timezone !== replica.timezone) throw new SyncInputError("云端与本地广告账号、站点、币种或时区绑定不一致。", 409);
    const fingerprint = await profileFingerprint(tx, scope, profile.id), version = adsReplicaVersion(replica);
    const entityId = `ads-replica-${digest([scope, profile.id, version])}`;
    const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.ads.entities.replica.published", entityId } });
    if (prior) {
      if ((prior.metadata as { fingerprint?: string } | null)?.fingerprint !== fingerprint) throw new SyncInputError("此广告副本已被更新版本替代，不能重复覆盖。", 409);
      return receipt(replica, version, true);
    }
    if (fingerprint !== expected.fingerprint) throw new SyncInputError("本地广告对象或绑定已变化，请重新拉取。", 409);
    const newest = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.ads.entities.replica.published", metadata: { path: ["profileRecordId"], equals: profile.id } }, orderBy: { createdAt: "desc" } });
    if (newest && String((newest.metadata as { exportedAt?: string }).exportedAt ?? "") >= replica.exportedAt) throw new SyncInputError("广告副本早于当前已发布版本，拒绝覆盖。", 409);
    if (await tx.amazonAdsSyncTask.count({ where: { ...scope, profileId: profile.id, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } } })) throw new SyncInputError("本地 Profile 仍有活动同步任务，不能覆盖对象。", 409);
    let plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: profile.id } });
    if (!plan) plan = await tx.amazonAdsSyncPlan.create({ data: { ...scope, id: `ads-replica-plan-${digest([scope, profile.id])}`, profileId: profile.id, actorUserId: actor, sellerAccountId: replica.sellerAccountId, authorizationRevision: profile.authorization.revision, status: "PAUSED" } });
    const taskIds = new Map<string, string>();
    for (const row of replica.rows) {
      const sourceTask = row.sourceTask;
      if (taskIds.has(sourceTask.id)) continue;
      const id = `${entityId}-${digest(sourceTask.id).slice(0, 16)}`;
      await tx.amazonAdsSyncTask.create({ data: { ...scope, id, planId: plan.id, profileId: profile.id, requestedByUserId: actor, idempotencyKey: id, planRevision: plan.revision, trigger: "cloud-replica", status: "SUCCEEDED", stage: sourceTask.stage, finishedAt: new Date(sourceTask.finishedAt) } });
      taskIds.set(sourceTask.id, id);
    }
    const incoming = replica.rows.map(row => ({ entityType: row.entityType, externalId: row.externalId }));
    // This table is the current entity projection, not an immutable raw archive.
    // Reconcile the exact Profile in the same transaction as all replacement rows.
    await tx.amazonAdsEntityRecord.deleteMany({ where: { ...scope, profileId: profile.id, ...(incoming.length ? { NOT: { OR: incoming } } : {}) } });
    for (const row of replica.rows) {
      const { sourceTask, ...fields } = row;
      const data = { ...fields, targetingExpression: fields.targetingExpression === null ? Prisma.DbNull : fields.targetingExpression, payload: fields.payload === null ? Prisma.JsonNull : fields.payload, startDate: fields.startDate ? new Date(fields.startDate) : null, endDate: fields.endDate ? new Date(fields.endDate) : null, sourceUpdatedAt: fields.sourceUpdatedAt ? new Date(fields.sourceUpdatedAt) : null, syncedAt: new Date(fields.syncedAt), sourceTaskId: taskIds.get(sourceTask.id)! };
      await tx.amazonAdsEntityRecord.upsert({ where: { organizationId_workspaceId_profileId_entityType_externalId: { ...scope, profileId: profile.id, entityType: row.entityType, externalId: row.externalId } }, create: { ...scope, id: `ads-entity-${digest([scope, profile.id, row.entityType, row.externalId])}`, profileId: profile.id, ...data }, update: data });
    }
    // Object transfer does not prove report coverage or official API execution here.
    await tx.amazonAdsSyncDomainState.upsert({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: profile.id, dataDomain: "entities", reportType: "" } }, create: { ...scope, id: `ads-replica-state-${digest([scope, profile.id])}`, profileId: profile.id, dataDomain: "entities", status: "UNKNOWN", warningCodes: ["CLOUD_REPLICA_OBJECTS_ONLY"] }, update: { status: "UNKNOWN", warningCodes: ["CLOUD_REPLICA_OBJECTS_ONLY"], lastTaskId: null, lastSuccessAt: null, coveredFrom: null, coveredTo: null } });
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId: profile.id }, tx);
    const publishedFingerprint = await profileFingerprint(tx, scope, profile.id);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.entities.replica.published", entityType: "AmazonAdsProfile", entityId, metadata: { workspaceId: scope.workspaceId, profileRecordId: profile.id, version, exportedAt: replica.exportedAt, fingerprint: publishedFingerprint, rowCount: replica.rows.length } } });
    return receipt(replica, version, false);
  }, { timeout: 20000 });
}
function receipt(value: AdsEntityReplica, version: string, replayed: boolean) {
  return { scope: "ads-entities", profileRecordId: value.profileRecordId, sellerAccountId: value.sellerAccountId, rowCount: value.rows.length, exportedAt: value.exportedAt, version, replayed, amazonApiCalled: false };
}
export async function pullAdsEntityReplica(scope: SyncScope, actor: string, profileRecordId: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("广告副本只允许在本地拉取。", 409);
  requireSyncCenter(scope);
  const expected = await prisma.$transaction(async tx => {
    await assertAmazonAction(scope, actor, "create", tx);
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId }, tx);
    return { profileRecordId, fingerprint: await profileFingerprint(tx, scope, profileRecordId) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const result = await relayAmazonExecution(scope, actor, { kind: "ads-entities-replica", profileRecordId });
  return publishAdsEntityReplica(scope, actor, result.replica, expected);
}
