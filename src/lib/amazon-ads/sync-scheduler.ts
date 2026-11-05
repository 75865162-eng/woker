import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { adsReadAdapterReady } from "./sync-adapter";
import { adsScopeEnabled, adsSyncKey, adsSyncScopes } from "./sync-policy";

const dueStatuses = ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"];
export async function tickAmazonAds(now = new Date()) {
  const scopes = adsSyncScopes();
  if (!scopes.length || !process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis" || !adsReadAdapterReady()) return;
  await prisma.amazonAdsSyncPlan.updateMany({ where: { OR: scopes, status: { in: ["WAITING_FOR_CONFIG", "WAITING_FOR_ADAPTER"] } }, data: { status: "ACTIVE", lastErrorCode: null, nextRunAt: now } });
  const expired = await prisma.amazonAdsSyncTask.findMany({ where: { OR: scopes, status: "RUNNING", leaseExpiresAt: { lt: now } }, take: 100 });
  for (const task of expired) {
    const exhausted = task.attempts + 1 >= task.maxAttempts;
    await prisma.amazonAdsSyncTask.updateMany({ where: { id: task.id, status: "RUNNING", fenceVersion: task.fenceVersion, leaseExpiresAt: { lt: now } }, data: { status: exhausted ? "FAILED" : "RETRY_WAIT", attempts: { increment: 1 }, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: exhausted ? now : null, errorCode: "ADS_TASK_LEASE_EXPIRED", errorMessage: "Worker lease expired; resume from committed checkpoint." } });
  }
  const pending = await prisma.amazonAdsSyncTask.findMany({ where: { OR: scopes, status: { in: ["WAITING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: "asc" }, take: 100 });
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
    const key = adsSyncKey([candidate.id, candidate.revision, today]);
    try {
      const task = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${candidate.profileId}`}, 0))`;
        const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: candidate.id, revision: candidate.revision, status: "ACTIVE", nextRunAt: { lte: now }, profile: { sellerAccountId: { not: null }, authorization: { status: "CONNECTED" } } } });
        if (!plan) return null;
        const active = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, planId: plan.id, status: { in: dueStatuses } }, select: { id: true } });
        if (active) return null;
        const fromDate = plan.lastSuccessAt ? new Date(plan.lastSuccessAt.getTime() - plan.attributionLagDays * 86400_000) : plan.historyStartDate ?? new Date(now.getTime() - 30 * 86400_000);
        const from = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
        const to = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86400_000);
        const found = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, idempotencyKey: key } });
        const created = found ?? await tx.amazonAdsSyncTask.create({ data: { ...scope, id: randomUUID(), planId: plan.id, profileId: plan.profileId, requestedByUserId: plan.actorUserId, idempotencyKey: key, planRevision: plan.revision, trigger: plan.lastSuccessAt ? "daily" : "initial-backfill", requestedFrom: from, requestedTo: to } });
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
