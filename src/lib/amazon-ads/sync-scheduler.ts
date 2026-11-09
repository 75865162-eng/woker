import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { adsReadAdapterReady } from "./sync-adapter";
import { adsScopeEnabled, adsSyncKey, adsSyncScopes } from "./sync-policy";
import { adsStructureTaskWhere } from "./task-routing";
import { configuredSyncScopes } from "@/lib/amazon-sync/activation";
import { ensureAdsPlan } from "./sync-service";

const dueStatuses = ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"];
export async function tickAmazonAds(now = new Date()) {
  if (!process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis" || !adsReadAdapterReady()) return;
  if (process.env.AMAZON_ADS_SYNC_ENABLED !== undefined && process.env.AMAZON_ADS_SYNC_ENABLED !== "true") return;
  const configured = configuredSyncScopes(process.env.AMAZON_ADS_SYNC_SCOPES ?? process.env.AMAZON_SYNC_CENTER_SCOPES);
  const scopes = configured === null ? await prisma.amazonAdsAuthorization.groupBy({ by: ["organizationId", "workspaceId"], where: { status: "CONNECTED" } }) : adsSyncScopes();
  if (!scopes.length) return;
  // Recover OAuth commits even if the browser disconnected or the first task
  // could not be created. One profile's failure does not stop healthy profiles.
  const uninitialized = await prisma.amazonAdsProfile.findMany({ where: { OR: scopes, authorization: { status: "CONNECTED" }, syncPlans: { none: {} } }, select: { id: true, organizationId: true, workspaceId: true, authorization: { select: { authorizedByUserId: true } } }, take: 100 });
  for (const profile of uninitialized) {
    try { await prisma.$transaction(tx => ensureAdsPlan(tx, { organizationId: profile.organizationId, workspaceId: profile.workspaceId }, profile.id, profile.authorization.authorizedByUserId)); }
    catch { console.error(`[amazon-ads] automatic binding deferred for ${profile.id}`); }
  }
  await prisma.amazonAdsSyncPlan.updateMany({ where: { OR: scopes, status: { in: ["WAITING_FOR_CONFIG", "WAITING_FOR_ADAPTER"] } }, data: { status: "ACTIVE", lastErrorCode: null, nextRunAt: now } });
  const expired = await prisma.amazonAdsSyncTask.findMany({ where: { ...adsStructureTaskWhere(), OR: scopes, status: "RUNNING", leaseExpiresAt: { lt: now } }, take: 100 });
  for (const task of expired) {
    const exhausted = task.attempts + 1 >= task.maxAttempts;
    // A lease expiry is evidence the worker vanished after a bounded page; resume
    // the committed checkpoint immediately, while normal API throttling stays in
    // the client-wide request budget.
    const retryAt = now;
    await prisma.$transaction(async tx => {
      const changed = await tx.amazonAdsSyncTask.updateMany({ where: { ...adsStructureTaskWhere(), organizationId: task.organizationId, workspaceId: task.workspaceId, id: task.id, status: "RUNNING", fenceVersion: task.fenceVersion, leaseExpiresAt: { lt: now } }, data: { status: exhausted ? "FAILED" : "RETRY_WAIT", attempts: { increment: 1 }, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: retryAt, finishedAt: exhausted ? now : null, errorCode: "ADS_TASK_LEASE_EXPIRED", errorMessage: "Worker lease expired; resume from committed checkpoint." } });
      if (!changed.count) return;
      await tx.amazonAdsSyncAttempt.updateMany({ where: { organizationId: task.organizationId, workspaceId: task.workspaceId, taskId: task.id, attemptNumber: task.dispatchVersion, status: "RUNNING" }, data: { status: exhausted ? "FAILED" : "RETRY_WAIT", finishedAt: now, retryAt: exhausted ? null : retryAt, errorCode: "ADS_TASK_LEASE_EXPIRED", safeErrorSummary: "Worker lease expired; will resume from the committed checkpoint." } });
      await tx.amazonAdsSyncDomainState.upsert({
        where: { organizationId_workspaceId_profileId_dataDomain_reportType: { organizationId: task.organizationId, workspaceId: task.workspaceId, profileId: task.profileId, dataDomain: "entities", reportType: "" } },
        create: { id: randomUUID(), organizationId: task.organizationId, workspaceId: task.workspaceId, profileId: task.profileId, dataDomain: "entities", reportType: "", status: exhausted ? "FAILED" : "RETRY_WAIT", lastAttemptAt: now, lastSuccessAt: null, lastTaskId: task.id, warningCodes: ["ADS_TASK_LEASE_EXPIRED"] },
        update: { status: exhausted ? "FAILED" : "RETRY_WAIT", lastAttemptAt: now, lastTaskId: task.id, warningCodes: ["ADS_TASK_LEASE_EXPIRED"] },
      });
    });
  }
  const pending = await prisma.amazonAdsSyncTask.findMany({ where: { ...adsStructureTaskWhere(), OR: scopes, status: { in: ["WAITING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 100 });
  for (const task of pending) {
    try {
      await getAmazonSyncQueue().add("process-amazon-ads-sync-task", { runId: task.id, adsTaskId: task.id, adsDispatchVersion: task.dispatchVersion }, { jobId: `ads-${task.id}-${task.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await prisma.amazonAdsSyncTask.updateMany({ where: { id: task.id, dispatchVersion: task.dispatchVersion, status: task.status }, data: { status: "QUEUED" } });
    } catch { console.error(`[amazon-ads] task recovery deferred for ${task.id}`); }
  }
  const plans = await prisma.amazonAdsSyncPlan.findMany({ where: { OR: scopes, status: "ACTIVE", nextRunAt: { lte: now }, profile: { sellerAccountId: { not: null }, authorization: { status: "CONNECTED" } } }, orderBy: { nextRunAt: "asc" }, take: 100 });
  for (const candidate of plans) {
    const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
    if (!adsScopeEnabled(scope)) continue;
    const today = now.toISOString().slice(0, 10);
    const key = adsSyncKey([candidate.id, candidate.revision, "SP_STRUCTURE", today]);
    try {
      const task = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${candidate.profileId}`}, 0))`;
        const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: candidate.id, revision: candidate.revision, status: "ACTIVE", nextRunAt: { lte: now }, profile: { sellerAccountId: { not: null }, authorization: { status: "CONNECTED" } } } });
        if (!plan) return null;
        const active = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, planId: plan.id, status: { in: dueStatuses } }, select: { id: true } });
        if (active) return null;
        const found = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, idempotencyKey: key } });
        const created = found ?? await tx.amazonAdsSyncTask.create({ data: { ...scope, id: randomUUID(), planId: plan.id, profileId: plan.profileId, requestedByUserId: plan.actorUserId, idempotencyKey: key, planRevision: plan.revision, trigger: "scheduled-structure" } });
        await tx.amazonAdsSyncPlan.update({ where: { id: plan.id }, data: { lastEnqueuedAt: now, nextRunAt: new Date(now.getTime() + plan.intervalMinutes * 60_000) } });
        return created;
      });
      if (task && ["WAITING", "RETRY_WAIT"].includes(task.status)) {
        await getAmazonSyncQueue().add("process-amazon-ads-sync-task", { runId: task.id, adsTaskId: task.id, adsDispatchVersion: task.dispatchVersion }, { jobId: `ads-${task.id}-${task.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
        await prisma.amazonAdsSyncTask.updateMany({ where: { ...scope, id: task.id, dispatchVersion: task.dispatchVersion, status: "WAITING" }, data: { status: "QUEUED" } });
      }
    } catch { console.error(`[amazon-ads] automatic plan dispatch deferred for ${candidate.id}`); }
  }
}
