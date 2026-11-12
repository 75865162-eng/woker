import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled, assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";
import { assertAmazonAction } from "@/lib/amazon-sync/data-access";
import { relayAmazonExecution } from "@/lib/amazon-sync/cloud-relay";
import { requireSyncCenter, SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";
import { amazonAdsAccountReadAccess } from "./read-access";
import { parseAdsReportReplica, reportReplicaFactLimit, reportReplicaVersionLimit, reportReplicaFactSelect, type AdsReportReplica, type ReportReplicaVersion } from "./report-replica-contract";
const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
export async function exportAdsReportReplica(scope: SyncScope, actor: string, profileRecordId: string) {
  assertAmazonCloudExecution(); requireSyncCenter(scope);
  const replica = await prisma.$transaction(async tx => {
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId }, tx);
    const profile = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: profileRecordId } });
    const versions = await tx.amazonAdsReportVersion.findMany({ where: { ...scope, profileId: profileRecordId, status: "PUBLISHED", publishedAt: { not: null }, sourceTask: { status: "SUCCEEDED" } }, orderBy: [{ publishedAt: "asc" }, { id: "asc" }], take: reportReplicaVersionLimit + 1, select: { id: true, requestedFrom: true, requestedTo: true, rowCount: true, publishedAt: true, sourceTask: { select: { id: true, stage: true, finishedAt: true } } } });
    if (!versions.length) throw new SyncInputError("云端尚无已发布广告报表，不能将未接入数据作为空报告。", 409);
    if (versions.length > reportReplicaVersionLimit) throw new SyncInputError("广告报表版本超过整批容量，未返回部分版本。", 409);
    const published = []; let total = 0;
    for (const version of versions) {
      const facts = await tx.amazonAdsReportFact.findMany({ where: { ...scope, profileId: profileRecordId, versionId: version.id, sourceTaskId: version.sourceTask.id }, select: reportReplicaFactSelect, orderBy: [{ reportType: "asc" }, { adProduct: "asc" }, { reportDate: "asc" }, { factKey: "asc" }], take: reportReplicaFactLimit - total + 1 });
      total += facts.length;
      if (total > reportReplicaFactLimit) throw new SyncInputError("广告报表事实超过整批容量，未返回不完整数据。", 409);
      published.push({ ...version, facts: facts.map(row => ({ ...row, rawDimensions: amazonBusinessData(row.rawDimensions) })) });
    }
    const body = wire({ version: 1, domain: "ads-reports", profileRecordId, amazonProfileId: profile.profileId, sellerAccountId: profile.sellerAccountId, marketplaceId: profile.marketplaceId, region: profile.region, currencyCode: profile.currencyCode, timezone: profile.timezone, versions: published });
    return parseAdsReportReplica({ ...body, digest: digest(body) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAdsAccountReadAccess(scope, actor, { profileRecordId });
  return replica;
}
async function localVersionFingerprint(tx: Prisma.TransactionClient, scope: SyncScope, profileId: string, id: string) {
  const version = await tx.amazonAdsReportVersion.findFirstOrThrow({ where: { ...scope, profileId, id }, select: { id: true, status: true, requestedFrom: true, requestedTo: true, rowCount: true, publishedAt: true, sourceTask: { select: { id: true, status: true, stage: true, finishedAt: true } } } });
  const facts = await tx.amazonAdsReportFact.findMany({ where: { ...scope, profileId, versionId: id }, select: reportReplicaFactSelect, orderBy: [{ reportType: "asc" }, { adProduct: "asc" }, { reportDate: "asc" }, { factKey: "asc" }], take: reportReplicaFactLimit + 1 });
  return digest(wire({ version, facts }));
}
function versionDigest(replica: AdsReportReplica, version: ReportReplicaVersion) {
  const { versions: unusedVersions, digest: unusedDigest, ...binding } = replica;
  void unusedVersions; void unusedDigest;
  return digest({ ...binding, version });
}
export async function publishAdsReportReplica(scope: SyncScope, actor: string, input: unknown, expectedProfileRecordId: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("广告报表副本只能在本地发布。", 409);
  requireSyncCenter(scope);
  const replica = parseAdsReportReplica(input);
  if (replica.profileRecordId !== expectedProfileRecordId) throw new SyncInputError("报表副本 Profile 不匹配。", 409);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "AmazonAdsProfile" WHERE id = ${replica.profileRecordId} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} FOR UPDATE`);
    await assertAmazonAction(scope, actor, "create", tx);
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId: replica.profileRecordId }, tx);
    const profile = await tx.amazonAdsProfile.findFirstOrThrow({ where: { ...scope, id: replica.profileRecordId }, include: { authorization: { select: { revision: true } } } });
    if (profile.sellerAccountId !== replica.sellerAccountId || profile.profileId !== replica.amazonProfileId || profile.marketplaceId !== replica.marketplaceId || profile.region !== replica.region || profile.currencyCode !== replica.currencyCode || profile.timezone !== replica.timezone) throw new SyncInputError("云端与本地广告账号、站点、币种或时区绑定不一致。", 409);
    let importedVersions = 0;
    for (const version of replica.versions) {
      const entityId = `ads-report-replica-${digest([scope, profile.id, version.id])}`, checksum = versionDigest(replica, version);
      const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.ads.reports.replica.published", entityId } });
      const existing = await tx.amazonAdsReportVersion.findFirst({ where: { id: version.id } });
      if (prior) {
        const metadata = prior.metadata as { checksum?: string; fingerprint?: string };
        if (metadata.checksum !== checksum || !existing || existing.organizationId !== scope.organizationId || existing.workspaceId !== scope.workspaceId || existing.profileId !== profile.id || metadata.fingerprint !== await localVersionFingerprint(tx, scope, profile.id, version.id)) throw new SyncInputError("已发布报表副本内容发生变化，禁止覆盖历史版本。", 409);
        continue;
      }
      if (existing) throw new SyncInputError("报表版本 ID 已被既有记录占用，未覆盖原数据。", 409);
      let plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, profileId: profile.id } });
      if (!plan) plan = await tx.amazonAdsSyncPlan.create({ data: { ...scope, id: `ads-replica-plan-${digest([scope, profile.id])}`, profileId: profile.id, actorUserId: actor, sellerAccountId: replica.sellerAccountId, authorizationRevision: profile.authorization.revision, status: "PAUSED" } });
      const taskId = `${entityId}:task`;
      await tx.amazonAdsSyncTask.create({ data: { ...scope, id: taskId, planId: plan.id, profileId: profile.id, requestedByUserId: actor, idempotencyKey: taskId, planRevision: plan.revision, trigger: "cloud-report-replica", status: "SUCCEEDED", stage: version.sourceTask.stage, finishedAt: new Date(version.sourceTask.finishedAt), requestedFrom: version.requestedFrom ? new Date(version.requestedFrom) : null, requestedTo: version.requestedTo ? new Date(version.requestedTo) : null, processedCount: version.rowCount } });
      // Original IDs and publication times preserve the existing rank tie-breaker.
      await tx.amazonAdsReportVersion.create({ data: { ...scope, id: version.id, profileId: profile.id, sourceTaskId: taskId, status: "PUBLISHED", requestedFrom: version.requestedFrom ? new Date(version.requestedFrom) : null, requestedTo: version.requestedTo ? new Date(version.requestedTo) : null, rowCount: version.rowCount, publishedAt: new Date(version.publishedAt) } });
      if (version.facts.length) await tx.amazonAdsReportFact.createMany({ data: version.facts.map((row, index) => ({ ...row, ...scope, id: `${entityId}:fact:${index}`, profileId: profile.id, versionId: version.id, sourceTaskId: taskId, reportDate: new Date(row.reportDate), syncedAt: new Date(row.syncedAt), impressions: row.impressions === null ? null : BigInt(row.impressions), clicks: row.clicks === null ? null : BigInt(row.clicks), orders: row.orders === null ? null : BigInt(row.orders), units: row.units === null ? null : BigInt(row.units), rawDimensions: row.rawDimensions === null ? Prisma.JsonNull : row.rawDimensions })) });
      const fingerprint = await localVersionFingerprint(tx, scope, profile.id, version.id);
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.reports.replica.published", entityType: "AmazonAdsReportVersion", entityId, metadata: { workspaceId: scope.workspaceId, profileRecordId: profile.id, cloudVersionId: version.id, cloudTaskId: version.sourceTask.id, checksum, fingerprint, rowCount: version.rowCount } } });
      importedVersions++;
    }
    await amazonAdsAccountReadAccess(scope, actor, { profileRecordId: profile.id }, tx);
    return { scope: "ads-reports", profileRecordId: profile.id, versionIds: replica.versions.map(version => version.id), importedVersions, replayed: importedVersions === 0, factCount: replica.versions.reduce((total, version) => total + version.rowCount, 0), amazonApiCalled: false };
  }, { timeout: 20000 });
}
export async function pullAdsReportReplica(scope: SyncScope, actor: string, profileRecordId: string) {
  if (amazonCloudExecutionEnabled()) throw new SyncInputError("广告报表副本只能在本地拉取。", 409);
  requireSyncCenter(scope);
  await assertAmazonAction(scope, actor, "create");
  await amazonAdsAccountReadAccess(scope, actor, { profileRecordId });
  const result = await relayAmazonExecution(scope, actor, { kind: "ads-reports-replica", profileRecordId });
  return publishAdsReportReplica(scope, actor, result.replica, profileRecordId);
}
