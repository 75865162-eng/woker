import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createAmazonAdsOAuthTransport } from "./oauth-contract";
import { decryptAmazonAdsRefreshToken, decryptAmazonAdsCheckpoint, encryptAmazonAdsCheckpoint } from "./credentials";
import { adsReadAdapterReady, amazonAdsReadAdapter, isAdsRegion, validateAdsPage } from "./sync-adapter";
import { adsSyncStages, parseAdsCheckpoint, AdsSyncError, adsSyncFailureStatus } from "./sync-policy";
import { assertAdsLivePlan } from "./sync-service";
import { withAmazonAdsClientLease } from "./api-budget";

const leaseMs = 5 * 60_000;
const workerId = `ads-${process.pid}-${randomUUID()}`;
const json = (value: Record<string, unknown>) => value as Prisma.InputJsonObject;

export async function processAmazonAdsSyncTask(taskId: string, dispatchVersion: number) {
  const initial = await prisma.amazonAdsSyncTask.findFirst({ where: { id: taskId, dispatchVersion }, include: { plan: true, profile: { include: { authorization: true } } } });
  if (!initial || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(initial.status) || initial.nextAttemptAt > new Date()) return;
  const scope = { organizationId: initial.organizationId, workspaceId: initial.workspaceId };
  const fenceVersion = initial.fenceVersion + 1;
  const leaseOwner = `${workerId}:${taskId}:${fenceVersion}`;
  const claimed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${initial.profileId}`}, 0))`;
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: initial.planId, revision: initial.planRevision, status: "ACTIVE" } });
    if (!plan) return false;
    const update = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: taskId, dispatchVersion, fenceVersion: initial.fenceVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date() } }, data: { status: "RUNNING", fenceVersion, leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseMs), startedAt: initial.startedAt ?? new Date(), errorCode: null, errorMessage: null } });
    return update.count === 1;
  });
  if (!claimed) return;
  try {
    if (!adsReadAdapterReady()) amazonAdsReadAdapter.assertImplemented();
    await prisma.$transaction(async tx => { await assertAdsLivePlan(tx, scope, initial.planId, initial.planRevision); });
    const clientId = process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim();
    const clientSecret = process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new AdsSyncError("ADS_OAUTH_CONFIG_MISSING");
    const auth = initial.profile.authorization;
    const region = initial.profile.region;
    const consentRegion = auth.consentRegion;
    if (!isAdsRegion(region) || !isAdsRegion(consentRegion)) throw new AdsSyncError("ADS_REGION_INVALID");
    const credentialScope = { ...scope, authorizationId: auth.id };
    const refreshToken = decryptAmazonAdsRefreshToken(auth.credentialsCiphertext, credentialScope);
    const accessToken = await createAmazonAdsOAuthTransport().refreshAccessToken({ region: consentRegion, refreshToken, clientId, clientSecret });
    const checkpoint = parseAdsCheckpoint(decryptAmazonAdsCheckpoint(initial.checkpointCiphertext, credentialScope, initial.id));
    const stage = adsSyncStages[checkpoint.stage];
    const dateRange = stage === "reports" && initial.requestedFrom && initial.requestedTo ? { from: initial.requestedFrom.toISOString().slice(0, 10), to: initial.requestedTo.toISOString().slice(0, 10) } : undefined;
    if (stage === "reports" && !dateRange) throw new AdsSyncError("ADS_REPORT_RANGE_MISSING");
    const page = validateAdsPage(await withAmazonAdsClientLease(clientId, leaseOwner, stage, () => amazonAdsReadAdapter.readPage({ stage, cursor: checkpoint.cursor, profileId: initial.profile.profileId, region, accessToken, clientId, ...(dateRange ? { dateRange } : {}) })), checkpoint.cursor);
    const pages = checkpoint.pages + 1;
    if (pages > 10000) throw new AdsSyncError("ADS_PAGE_LIMIT_EXCEEDED");
    const checkpointAfter = page.nextCursor ? { stage: checkpoint.stage, cursor: page.nextCursor, pages } : { stage: checkpoint.stage + 1, cursor: null, pages: 0 };
    const ciphertext = encryptAmazonAdsCheckpoint(checkpointAfter, credentialScope, initial.id);
    const stageFinished = checkpointAfter.stage >= adsSyncStages.length;
    let insertedCount = 0, updatedCount = 0;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${initial.profileId}`}, 0))`;
      const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: taskId, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner } });
      if (!task) throw new AdsSyncError("ADS_TASK_FENCE_LOST");
      await assertAdsLivePlan(tx, scope, initial.planId, initial.planRevision);
      const reportVersion = stage === "reports" ? await tx.amazonAdsReportVersion.upsert({
        where: { organizationId_workspaceId_sourceTaskId: { ...scope, sourceTaskId: initial.id } },
        create: { id: randomUUID(), ...scope, profileId: initial.profileId, sourceTaskId: initial.id, requestedFrom: initial.requestedFrom, requestedTo: initial.requestedTo },
        update: {},
      }) : null;
      for (const entity of page.entities) {
        const where = { organizationId_workspaceId_profileId_entityType_externalId: { ...scope, profileId: initial.profileId, entityType: entity.entityType, externalId: entity.externalId } };
        const exists = await tx.amazonAdsEntityRecord.findUnique({ where, select: { id: true } });
        await tx.amazonAdsEntityRecord.upsert({ where, create: { id: randomUUID(), ...scope, profileId: initial.profileId, entityType: entity.entityType, externalId: entity.externalId, parentExternalId: entity.parentExternalId ?? null, state: entity.state ?? null, payload: json(entity.payload), sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : null, sourceTaskId: initial.id }, update: { parentExternalId: entity.parentExternalId ?? null, state: entity.state ?? null, payload: json(entity.payload), sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : null, sourceTaskId: initial.id, syncedAt: new Date() } });
        if (exists) updatedCount += 1; else insertedCount += 1;
      }
      for (const fact of page.reportFacts ?? []) {
        if (!reportVersion) throw new AdsSyncError("ADS_REPORT_VERSION_MISSING");
        const reportDate = new Date(`${fact.reportDate}T00:00:00.000Z`);
        const where = { organizationId_workspaceId_versionId_reportType_adProduct_reportDate_factKey: { ...scope, versionId: reportVersion.id, reportType: fact.reportType, adProduct: fact.adProduct, reportDate, factKey: fact.factKey } };
        await tx.amazonAdsReportFact.upsert({ where, create: { id: randomUUID(), ...scope, profileId: initial.profileId, versionId: reportVersion.id, ...fact, reportDate, campaignId: fact.campaignId ?? null, adGroupId: fact.adGroupId ?? null, targetingId: fact.targetingId ?? null, advertisedAsin: fact.advertisedAsin ?? null, searchTerm: fact.searchTerm ?? null, placement: fact.placement ?? null, impressions: BigInt(fact.impressions), clicks: BigInt(fact.clicks), spend: new Prisma.Decimal(fact.spend), orders: BigInt(fact.orders), sales: new Prisma.Decimal(fact.sales), units: BigInt(fact.units), attributionWindow: fact.attributionWindow ?? null, sourceTaskId: initial.id, rawDimensions: json(fact.rawDimensions) }, update: { impressions: BigInt(fact.impressions), clicks: BigInt(fact.clicks), spend: new Prisma.Decimal(fact.spend), orders: BigInt(fact.orders), sales: new Prisma.Decimal(fact.sales), units: BigInt(fact.units), attributionWindow: fact.attributionWindow ?? null, apiVersion: fact.apiVersion, sourceTaskId: initial.id, rawDimensions: json(fact.rawDimensions), syncedAt: new Date() } });
      }
      if (reportVersion && page.reportFacts?.length) await tx.amazonAdsReportVersion.update({ where: { id: reportVersion.id }, data: { rowCount: { increment: page.reportFacts.length } } });
      if (reportVersion && stageFinished) await tx.amazonAdsReportVersion.updateMany({ where: { id: reportVersion.id, ...scope, status: "STAGING" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: taskId, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner }, data: { stage: stageFinished ? "COMPLETED" : adsSyncStages[checkpointAfter.stage], checkpointCiphertext: ciphertext, processedCount: { increment: page.entities.length + (page.reportFacts?.length ?? 0) }, insertedCount: { increment: insertedCount }, updatedCount: { increment: updatedCount }, apiRequests: { increment: 1 }, status: stageFinished ? "SUCCEEDED" : "WAITING", dispatchVersion: stageFinished ? dispatchVersion : dispatchVersion + 1, leaseOwner: null, leaseExpiresAt: null, finishedAt: stageFinished ? new Date() : null, nextAttemptAt: new Date() } });
      if (!changed.count) throw new AdsSyncError("ADS_TASK_FENCE_LOST");
      if (stageFinished) await tx.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: initial.planId, revision: initial.planRevision, status: "ACTIVE" }, data: { lastSuccessAt: new Date(), lastErrorCode: null } });
    });
    const current = !stageFinished && await prisma.amazonAdsSyncTask.findFirst({ where: { ...scope, id: initial.id, dispatchVersion: dispatchVersion + 1, fenceVersion, status: "WAITING" }, select: { dispatchVersion: true } });
    if (current) await getAmazonSyncQueue().add("process-amazon-ads-sync-task", { runId: initial.id, adsTaskId: initial.id, adsDispatchVersion: current.dispatchVersion }, { jobId: `ads-${initial.id}-${current.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
  } catch (error) {
    const code = error instanceof AdsSyncError ? error.code : error instanceof Error ? error.message.slice(0, 100) : "ADS_SYNC_FAILED";
    const adapterReady = adsReadAdapterReady();
    const retryable = !(error instanceof AdsSyncError) || error.retryable;
    const exhausted = initial.attempts + 1 >= initial.maxAttempts;
    const status = adsSyncFailureStatus({ adapterReady, retryable, exhausted });
    const blocked = status === "BLOCKED" || status === "WAITING_FOR_ADAPTER";
    await prisma.$transaction(async tx => {
      const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: initial.id, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner }, data: { status, attempts: status === "BLOCKED" || status === "WAITING_FOR_ADAPTER" ? undefined : { increment: 1 }, throttles: error instanceof AdsSyncError && error.retryAfterMs > 0 ? { increment: 1 } : undefined, errorCode: code, errorMessage: "Ads 同步未完成；已保留检查点，需检查配置或任务后重试。", nextAttemptAt: new Date(Date.now() + (error instanceof AdsSyncError ? Math.max(5000, error.retryAfterMs) : 30000)), dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, finishedAt: status === "BLOCKED" || status === "WAITING_FOR_ADAPTER" || status === "FAILED" ? new Date() : null } });
      if (changed.count && (status === "BLOCKED" || status === "WAITING_FOR_ADAPTER")) await tx.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: initial.planId, status: "ACTIVE" }, data: { status, lastErrorCode: code } });
      if (changed.count) await tx.auditLog.create({ data: { organizationId: scope.organizationId, action: "amazon.ads.sync.task.failed", entityType: "AmazonAdsSyncTask", entityId: initial.id, metadata: { workspaceId: scope.workspaceId, profileId: initial.profileId, code, retryable: !blocked } } });
    });
    if (!blocked) throw error;
  }
}
