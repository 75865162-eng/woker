import "./runtime/worker-bootstrap.mjs";
import { createHeartbeatWriter } from "@/lib/runtime/heartbeat-writer";
import { observeWorker, runtimeHeartbeatMetadata } from "@/lib/runtime/worker-diagnostics";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { recoverExpiredSellfoxRuns, SellfoxLeaseLostError, sellfoxMaxRunAttempts } from "@/lib/sellfox/run-lease";
import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxScheduledBackfill } from "@/lib/sellfox/schedule-backfill";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { isSellfoxScheduleDue as due, sellfoxSyncScopeLock } from "@/lib/sellfox/schedule-time";
import { recoverSellfoxQueueRun } from "@/lib/sellfox/queue-recovery";
import { createRedisConnectionOptions, sellfoxSyncQueueName } from "@/lib/queue/redis-queue";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { generateAdsProposals } from "@/lib/sellfox/ads-proposal";
import { SellfoxRequestError, closeSellfoxClient } from "@/lib/sellfox/client";
import { normalizeSellfoxDates, sellfoxSyncDisabledReason, SellfoxSyncInputError, SellfoxSyncUnavailableError, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";

const workerName = process.env.SELLFOX_SYNC_WORKER_NAME?.trim() || `${sellfoxSyncQueueName}-${process.pid}`;
const workerId = process.env.SELLFOX_SYNC_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const worker = new Worker<{ runId: string }>(sellfoxSyncQueueName, async (job) => {
  try { await processSellfoxSyncRun(job.data.runId); }
  catch (error) {
    if (error instanceof SellfoxLeaseLostError) return; // A newer owner (or recovery) controls the persisted run.
    if (error instanceof SellfoxSyncUnavailableError || error instanceof SellfoxSyncInputError || (error instanceof SellfoxStoreSyncError && !error.retryable) || (error instanceof SellfoxRequestError && !error.retryable)) {
      throw new UnrecoverableError(error.message);
    }
    if (job.attemptsMade >= (job.opts.attempts ?? 4) - 1) throw new Error(sellfoxStoreFailure(error).error);
    await prisma.sellfoxSyncRun.updateMany({ where: { id: job.data.runId, status: "failed", executionToken: null, executionAttempts: { lt: sellfoxMaxRunAttempts } }, data: { status: "queued", error: "同步暂时失败，系统将按退避策略重试。", finishedAt: null } });
    throw new Error(sellfoxStoreFailure(error).error);
  }
}, { connection: createRedisConnectionOptions(), concurrency: 1 });

let recovering = false;
async function recoverAndSchedule() {
  if (recovering) return;
  recovering = true;
  try {
    await recoverExpiredSellfoxRuns();
    const pending = await prisma.sellfoxSyncRun.findMany({ where: { status: "queued" }, orderBy: { startedAt: "asc" }, take: 50 });
    for (const run of pending) await recoverSellfoxQueueRun(run.id);
    if (process.env.QUEUE_DRIVER !== "redis") return;
    const credentialStatuses = new Map<string, Promise<boolean>>();
    const schedules = await prisma.sellfoxSyncSchedule.findMany({ where: { enabled: true }, orderBy: { lastEnqueuedAt: "asc" }, take: 100 });
    for (const candidate of schedules) {
      const disabledReason = sellfoxSyncDisabledReason(candidate.resource);
      if (disabledReason) {
        await prisma.sellfoxSyncSchedule.update({ where: { id: candidate.id }, data: { enabled: false } });
        await prisma.sellfoxSyncRun.create({ data: { id: `sellfox-sync-${randomUUID()}`, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId, userId: candidate.userId, resource: candidate.resource, status: "failed", error: disabledReason, summary: { trigger: "schedule", scheduleId: candidate.id }, finishedAt: new Date() } });
        continue;
      }
      const now = new Date();
      if (!due(candidate, now)) continue;
      const scopeKey = JSON.stringify([candidate.organizationId, candidate.workspaceId]);
      if (!credentialStatuses.has(scopeKey)) credentialStatuses.set(scopeKey, getSellfoxCredentialStatus({ organizationId: candidate.organizationId, workspaceId: candidate.workspaceId }).then(status => status.configured));
      if (!(await credentialStatuses.get(scopeKey))) continue;
      await prisma.$transaction(async (tx) => {
        const lockKey = sellfoxSyncScopeLock(candidate.organizationId, candidate.workspaceId, candidate.resource);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const schedule = await tx.sellfoxSyncSchedule.findUnique({ where: { id: candidate.id } });
        if (!schedule?.enabled || !due(schedule, now)) return;
        if (!(await canExecuteSellfoxSync(schedule))) {
          await tx.sellfoxSyncSchedule.update({ where: { id: schedule.id }, data: { enabled: false } });
          await tx.sellfoxSyncRun.create({ data: { id: `sellfox-sync-${randomUUID()}`, organizationId: schedule.organizationId, workspaceId: schedule.workspaceId, userId: schedule.userId, resource: schedule.resource, status: "failed", error: "定时同步已暂停：启用计划的用户或工作区已失去有效权限。", summary: { trigger: "schedule", scheduleId: schedule.id }, finishedAt: now } });
          return;
        }
        // Historical backlog must not block the daily slot. The same serial worker executes both.
        const active = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SellfoxSyncRun"
          WHERE "organizationId"=${schedule.organizationId} AND "workspaceId"=${schedule.workspaceId}
            AND resource=${schedule.resource} AND status IN ('queued','running')
            AND COALESCE(summary->>'trigger','') <> 'manual_backfill' LIMIT 1`;
        if (active.length) return;
        const history = await sellfoxScheduledBackfill(tx, schedule, now, Math.min(90, Math.max(1, Math.floor(Number(process.env.SELLFOX_BACKFILL_DAYS_PER_RUN) || 7))));
        const runId = `sellfox-sync-${randomUUID()}`;
        await tx.sellfoxSyncRun.create({ data: { id: runId, organizationId: schedule.organizationId, workspaceId: schedule.workspaceId, userId: schedule.userId, resource: schedule.resource, status: "queued", summary: { trigger: "schedule", scheduleId: schedule.id, ...history, ...normalizeSellfoxDates(schedule.resource as SellfoxSyncResource, {}, now), datesFrozen: true, requestVersion: 2 } } });
        await tx.sellfoxSyncSchedule.update({ where: { id: schedule.id }, data: { lastEnqueuedAt: now } });
      });
    }
    const scheduledPending = await prisma.sellfoxSyncRun.findMany({ where: { status: "queued", summary: { path: ["trigger"], equals: "schedule" } }, orderBy: { startedAt: "asc" }, take: 50 });
    for (const run of scheduledPending) await recoverSellfoxQueueRun(run.id);
  } finally { recovering = false; }
}

observeWorker(worker, "sellfox-sync-worker");

async function persistHeartbeat(status: "online" | "stopping") {
  if (!process.env.DATABASE_URL) return;
  await prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: { id: workerId, workerName, queueName: sellfoxSyncQueueName, status, concurrency: 1, lastSeenAt: new Date(), metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue },
    update: { status, concurrency: 1, lastSeenAt: new Date(), metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue },
  });
}

const heartbeat = createHeartbeatWriter(persistHeartbeat);

function tickFailure(error: unknown) {
  // Unknown errors are intentionally masked for run logs; worker stdout may keep the class only.
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
  return `${sellfoxStoreFailure(error).error} [${detail}]`;
}

void recoverAndSchedule().catch((error) => console.error("[sellfox-sync-worker] schedule recovery failed", tickFailure(error)));
const recoveryTimer = setInterval(() => void recoverAndSchedule().catch((error) => console.error("[sellfox-sync-worker] schedule tick failed", tickFailure(error))), 30_000);
const heartbeatTimer = setInterval(() => void heartbeat().catch((error) => console.error("[sellfox-sync-worker] heartbeat failed", sellfoxStoreFailure(error).error)), 30_000);
void heartbeat().catch(() => undefined);
worker.on("completed", (job) => {
  console.log(`[sellfox-sync-worker] completed ${job.data.runId}`);
  // 广告域同步完成后自动重算「库存×广告」优化方案，保持方案看板当日最新。
  void (async () => {
    const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: job.data.runId }, select: { resource: true } });
    if (!run?.resource.startsWith("ads_")) return;
    const scopes = await prisma.sellfoxSyncSchedule.findMany({
      where: { enabled: true, resource: { in: ["ads_report", "ads_campaign", "ads_ad_group", "ads_targeting", "ads_search_term", "ads_placement"] } },
      select: { organizationId: true, workspaceId: true }, distinct: ["organizationId", "workspaceId"],
    });
    for (const scope of scopes) {
      try { await generateAdsProposals(scope.organizationId, scope.workspaceId); }
      catch (error) { console.error("[sellfox-sync-worker] ads proposal regeneration failed", sellfoxStoreFailure(error).error); }
    }
  })();
});
worker.on("failed", (job, error) => console.error(`[sellfox-sync-worker] failed ${job?.data.runId ?? "unknown"}: ${sellfoxStoreFailure(error).error}`));

async function shutdown() {
  clearInterval(recoveryTimer); clearInterval(heartbeatTimer);
  await heartbeat("stopping").catch(() => undefined); await worker.close(); await closeSellfoxClient(); await prisma.$disconnect(); process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
console.log(`[sellfox-sync-worker] listening on ${sellfoxSyncQueueName}`);
