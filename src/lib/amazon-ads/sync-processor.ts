import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createAmazonAdsOAuthTransport, type AmazonAdsOAuthTransport } from "./oauth-contract";
import { decryptAmazonAdsRefreshToken, decryptAmazonAdsCheckpoint, encryptAmazonAdsCheckpoint } from "./credentials";
import { adsReadAdapterReady, amazonAdsReadAdapter, isAdsRegion, validateAdsPage, type AdsReadAdapter } from "./sync-adapter";
import { adsSyncStages, adsStructureStageCount, parseAdsCheckpoint, AdsSyncError, adsSyncFailureStatus } from "./sync-policy";
import { assertAdsLivePlan } from "./sync-service";
import { withAmazonAdsClientLease } from "./api-budget";
import { adsStructureTaskWhere } from "./task-routing";

const leaseMs = 5 * 60_000;
const workerId = `ads-${process.pid}-${randomUUID()}`;
const json = (value: Record<string, unknown>) => value as Prisma.InputJsonObject;

function normalizeAdsEntity(payload: Record<string, unknown>) {
  const budget = payload.budget && typeof payload.budget === "object" && !Array.isArray(payload.budget) ? payload.budget as Record<string, unknown> : undefined;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ? new Date(`${value}T00:00:00.000Z`) : null;
  return {
    name: text(payload.name),
    adProduct: text(payload.adProduct),
    campaignId: text(payload.campaignId),
    adGroupId: text(payload.adGroupId),
    startDate: date(payload.startDate),
    endDate: date(payload.endDate),
    targetingType: text(payload.targetingType),
    budgetAmount: number(budget?.budget),
    budgetType: text(budget?.budgetType),
    bid: number(payload.bid ?? payload.defaultBid),
    keywordText: text(payload.keywordText),
    matchType: text(payload.matchType),
    expressionType: text(payload.expressionType),
    targetingExpression: Array.isArray(payload.expression) ? payload.expression as Prisma.InputJsonArray : Prisma.JsonNull,
  };
}

export async function processAmazonAdsSyncTask(taskId: string, dispatchVersion: number, transport: { adapter?: AdsReadAdapter; oauth?: AmazonAdsOAuthTransport } = {}) {
  const adapter = transport.adapter ?? amazonAdsReadAdapter;
  const initial = await prisma.amazonAdsSyncTask.findFirst({ where: { ...adsStructureTaskWhere(), id: taskId, dispatchVersion }, include: { plan: true, profile: { include: { authorization: true } } } });
  if (!initial || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(initial.status) || initial.nextAttemptAt > new Date()) return;
  const scope = { organizationId: initial.organizationId, workspaceId: initial.workspaceId };
  const fenceVersion = initial.fenceVersion + 1;
  const attemptNumber = initial.dispatchVersion;
  const leaseOwner = `${workerId}:${taskId}:${fenceVersion}`;
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${initial.profileId}`}, 0))`;
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: initial.planId, revision: initial.planRevision, status: "ACTIVE" } });
    if (!plan) return false;
    const update = await tx.amazonAdsSyncTask.updateMany({ where: { ...adsStructureTaskWhere(), ...scope, id: taskId, dispatchVersion, fenceVersion: initial.fenceVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date() } }, data: { status: "RUNNING", fenceVersion, leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseMs), startedAt: initial.startedAt ?? new Date(), errorCode: null, errorMessage: null } });
    if (update.count !== 1) return false;
    await tx.amazonAdsSyncAttempt.upsert({
      where: { organizationId_workspaceId_taskId_attemptNumber: { ...scope, taskId, attemptNumber } },
      create: { id: randomUUID(), ...scope, profileId: initial.profileId, taskId, attemptNumber, stage: initial.stage, status: "RUNNING" },
      update: { stage: initial.stage, status: "RUNNING", startedAt: new Date(), finishedAt: null, retryAt: null, errorCode: null, safeErrorSummary: null, apiRequests: 0, processedCount: 0 },
    });
    return true;
  });
  if (!claimed) return;
  let apiRequests = 0;
  try {
    if (!adsReadAdapterReady()) adapter.assertImplemented();
    await prisma.$transaction(async tx => { await assertAdsLivePlan(tx, scope, initial.planId, initial.planRevision); });
    const clientId = process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim();
    const clientSecret = process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new AdsSyncError("ADS_OAUTH_CONFIG_MISSING");
    const auth = initial.profile.authorization;
    const region = initial.profile.region;
    const consentRegion = auth.consentRegion;
    if (!isAdsRegion(region) || !isAdsRegion(consentRegion)) throw new AdsSyncError("ADS_REGION_INVALID");
    const credentialScope = { ...scope, authorizationId: auth.id };
    const checkpoint = parseAdsCheckpoint(decryptAmazonAdsCheckpoint(initial.checkpointCiphertext, credentialScope, initial.id));
    const stage = adsSyncStages[checkpoint.stage];
    if (checkpoint.stage >= adsStructureStageCount) throw new AdsSyncError("ADS_REPORT_ADAPTER_NOT_IMPLEMENTED");
    const refreshToken = decryptAmazonAdsRefreshToken(auth.credentialsCiphertext, credentialScope);
    const accessToken = await (transport.oauth ?? createAmazonAdsOAuthTransport()).refreshAccessToken({ region: consentRegion, refreshToken, clientId, clientSecret });
    const dateRange = stage === "reports" && initial.requestedFrom && initial.requestedTo ? { from: initial.requestedFrom.toISOString().slice(0, 10), to: initial.requestedTo.toISOString().slice(0, 10) } : undefined;
    if (stage === "reports" && !dateRange) throw new AdsSyncError("ADS_REPORT_RANGE_MISSING");
    const page = validateAdsPage(await withAmazonAdsClientLease(clientId, leaseOwner, stage, () => {
      apiRequests = 1;
      return adapter.readPage({ stage, cursor: checkpoint.cursor, profileId: initial.profile.profileId, region, accessToken, clientId, ...(dateRange ? { dateRange } : {}) });
    }), checkpoint.cursor);
    if (page.reportFacts?.length) throw new AdsSyncError("ADS_UNEXPECTED_REPORT_FACTS");
    const pages = checkpoint.pages + 1;
    if (pages > 10000) throw new AdsSyncError("ADS_PAGE_LIMIT_EXCEEDED");
    const checkpointAfter = page.nextCursor ? { stage: checkpoint.stage, cursor: page.nextCursor, pages } : { stage: checkpoint.stage + 1, cursor: null, pages: 0 };
    const ciphertext = encryptAmazonAdsCheckpoint(checkpointAfter, credentialScope, initial.id);
    const stageFinished = checkpointAfter.stage >= adsStructureStageCount;
    let insertedCount = 0, updatedCount = 0;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${initial.profileId}`}, 0))`;
      const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: taskId, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner } });
      if (!task || !task.leaseExpiresAt || task.leaseExpiresAt <= new Date()) throw new AdsSyncError("ADS_TASK_FENCE_LOST");
      await assertAdsLivePlan(tx, scope, initial.planId, initial.planRevision);
      for (const entity of page.entities) {
        const where = { organizationId_workspaceId_profileId_entityType_externalId: { ...scope, profileId: initial.profileId, entityType: entity.entityType, externalId: entity.externalId } };
        const normalized = normalizeAdsEntity(entity.payload);
        const exists = await tx.amazonAdsEntityRecord.findUnique({ where, select: { id: true, sourceUpdatedAt: true, sourceTask: { select: { createdAt: true, id: true } } } });
        // A current snapshot cannot be replaced by an older task or source observation.
        if (exists && (exists.sourceTask.createdAt > initial.createdAt
          || (exists.sourceTask.createdAt.getTime() === initial.createdAt.getTime() && exists.sourceTask.id > initial.id)
          || (exists.sourceUpdatedAt && (!entity.sourceUpdatedAt || exists.sourceUpdatedAt > new Date(entity.sourceUpdatedAt))))) continue;
        await tx.amazonAdsEntityRecord.upsert({ where, create: { id: randomUUID(), ...scope, profileId: initial.profileId, entityType: entity.entityType, externalId: entity.externalId, parentExternalId: entity.parentExternalId ?? null, state: entity.state ?? null, ...normalized, payload: json(entity.payload), sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : null, sourceTaskId: initial.id }, update: { parentExternalId: entity.parentExternalId ?? null, state: entity.state ?? null, ...normalized, payload: json(entity.payload), sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : null, sourceTaskId: initial.id, syncedAt: new Date() } });
        if (exists) updatedCount += 1; else insertedCount += 1;
      }
      const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: taskId, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner }, data: { stage: stageFinished ? "COMPLETED_SP_STRUCTURE" : adsSyncStages[checkpointAfter.stage], checkpointCiphertext: ciphertext, processedCount: { increment: page.entities.length }, insertedCount: { increment: insertedCount }, updatedCount: { increment: updatedCount }, apiRequests: { increment: 1 }, status: stageFinished ? "SUCCEEDED" : "WAITING", dispatchVersion: stageFinished ? dispatchVersion : dispatchVersion + 1, leaseOwner: null, leaseExpiresAt: null, finishedAt: stageFinished ? new Date() : null, nextAttemptAt: new Date() } });
      if (!changed.count) throw new AdsSyncError("ADS_TASK_FENCE_LOST");
      await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: initial.id, attemptNumber }, data: { stage: stageFinished ? "COMPLETED_SP_STRUCTURE" : stage, status: "SUCCEEDED", finishedAt: new Date(), retryAt: null, errorCode: null, safeErrorSummary: null, apiRequests, processedCount: page.entities.length } });
      await tx.amazonAdsSyncDomainState.upsert({
        where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: initial.profileId, dataDomain: "entities", reportType: "" } },
        create: { id: randomUUID(), ...scope, profileId: initial.profileId, dataDomain: "entities", reportType: "", status: stageFinished ? "CURRENT" : "SYNCING", lastAttemptAt: new Date(), lastSuccessAt: stageFinished ? new Date() : null, lastTaskId: initial.id, warningCodes: [] },
        update: { status: stageFinished ? "CURRENT" : "SYNCING", lastAttemptAt: new Date(), ...(stageFinished ? { lastSuccessAt: new Date() } : {}), lastTaskId: initial.id, warningCodes: [] },
      });
      if (stageFinished) await tx.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: initial.planId, revision: initial.planRevision, status: "ACTIVE" }, data: { lastSuccessAt: new Date(), lastErrorCode: null } });
    });
    const current = !stageFinished && await prisma.amazonAdsSyncTask.findFirst({ where: { ...scope, id: initial.id, dispatchVersion: dispatchVersion + 1, fenceVersion, status: "WAITING" }, select: { dispatchVersion: true } });
    if (current) await getAmazonSyncQueue().add("process-amazon-ads-sync-task", { runId: initial.id, adsTaskId: initial.id, adsDispatchVersion: current.dispatchVersion }, { jobId: `ads-${initial.id}-${current.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
  } catch (error) {
    const code = error instanceof AdsSyncError ? error.code : "ADS_SYNC_FAILED";
    const adapterReady = adsReadAdapterReady();
    const retryable = !(error instanceof AdsSyncError) || error.retryable;
    const exhausted = initial.attempts + 1 >= initial.maxAttempts;
    const status = adsSyncFailureStatus({ adapterReady, retryable, exhausted });
    const blocked = status === "BLOCKED" || status === "WAITING_FOR_ADAPTER";
    await prisma.$transaction(async tx => {
      const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, id: initial.id, dispatchVersion, fenceVersion, status: "RUNNING", leaseOwner }, data: { status, attempts: status === "BLOCKED" || status === "WAITING_FOR_ADAPTER" ? undefined : { increment: 1 }, throttles: error instanceof AdsSyncError && error.retryAfterMs > 0 ? { increment: 1 } : undefined, errorCode: code, errorMessage: "Ads 同步未完成；已保留检查点，需检查配置或任务后重试。", nextAttemptAt: new Date(Date.now() + (error instanceof AdsSyncError ? Math.max(5000, error.retryAfterMs) : 30000)), dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, finishedAt: status === "BLOCKED" || status === "WAITING_FOR_ADAPTER" || status === "FAILED" ? new Date() : null } });
      if (changed.count) {
        await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: initial.id, attemptNumber }, data: { status, finishedAt: new Date(), retryAt: status === "RETRY_WAIT" ? new Date(Date.now() + (error instanceof AdsSyncError ? Math.max(5000, error.retryAfterMs) : 30000)) : null, errorCode: code, safeErrorSummary: "Ads 同步未完成；已保留检查点。", apiRequests, processedCount: 0 } });
        await tx.amazonAdsSyncDomainState.upsert({
          where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: initial.profileId, dataDomain: "entities", reportType: "" } },
          create: { id: randomUUID(), ...scope, profileId: initial.profileId, dataDomain: "entities", reportType: "", status: status === "RETRY_WAIT" ? "RETRY_WAIT" : "FAILED", lastAttemptAt: new Date(), lastSuccessAt: null, lastTaskId: initial.id, warningCodes: [code] },
          update: { status: status === "RETRY_WAIT" ? "RETRY_WAIT" : "FAILED", lastAttemptAt: new Date(), lastTaskId: initial.id, warningCodes: [code] },
        });
        if (status === "BLOCKED" || status === "WAITING_FOR_ADAPTER") await tx.amazonAdsSyncPlan.updateMany({ where: { ...scope, id: initial.planId, status: "ACTIVE" }, data: { status, lastErrorCode: code } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, action: "amazon.ads.sync.task.failed", entityType: "AmazonAdsSyncTask", entityId: initial.id, metadata: { workspaceId: scope.workspaceId, profileId: initial.profileId, code, retryable: !blocked } } });
      }
    });
    if (!blocked) throw error;
  }
}
