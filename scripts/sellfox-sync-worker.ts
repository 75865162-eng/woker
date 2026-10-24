import "dotenv/config";
import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { enqueueSellfoxSyncRun } from "@/lib/queue";
import { createRedisConnectionOptions, sellfoxSyncQueueName } from "@/lib/queue/redis-queue";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";
import { SellfoxRequestError } from "@/lib/sellfox/client";
import { sellfoxSyncDisabledReason, SellfoxSyncUnavailableError } from "@/lib/sellfox/sync-contract";

const workerName = process.env.SELLFOX_SYNC_WORKER_NAME?.trim() || `${sellfoxSyncQueueName}-${process.pid}`;
const workerId = process.env.SELLFOX_SYNC_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const worker = new Worker<{ runId: string }>(sellfoxSyncQueueName, async (job) => {
  try { await processSellfoxSyncRun(job.data.runId); }
  catch (error) {
    if (error instanceof SellfoxSyncUnavailableError || (error instanceof SellfoxRequestError && !error.retryable)) {
      throw new UnrecoverableError(error.message);
    }
    if (job.attemptsMade >= (job.opts.attempts ?? 4) - 1) throw error;
    await prisma.sellfoxSyncRun.updateMany({ where: { id: job.data.runId, status: "failed" }, data: { status: "queued", error: "同步暂时失败，系统将按退避策略重试。", finishedAt: null } });
    throw error;
  }
}, { connection: createRedisConnectionOptions(), concurrency: 1 });

function shanghaiDate(now: Date) { return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); }
function isDailyResource(resource: string) { return resource === "sales" || resource === "performance"; }
function due(schedule: { resource: string; intervalMinutes: number; lastEnqueuedAt: Date | null }, now: Date) {
  if (isDailyResource(schedule.resource)) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const clock = Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return clock >= 390 && (!schedule.lastEnqueuedAt || shanghaiDate(schedule.lastEnqueuedAt) !== shanghaiDate(now));
  }
  return !schedule.lastEnqueuedAt || now.getTime() - schedule.lastEnqueuedAt.getTime() >= schedule.intervalMinutes * 60_000;
}

let recovering = false;
async function recoverAndSchedule() {
  if (recovering) return;
  recovering = true;
  try {
    const pending = await prisma.sellfoxSyncRun.findMany({ where: { status: "queued" }, orderBy: { startedAt: "asc" }, take: 50 });
    for (const run of pending) await enqueueSellfoxSyncRun(run.id);
    if (process.env.QUEUE_DRIVER !== "redis" || !process.env.SELLFOX_CLIENT_ID || !process.env.SELLFOX_CLIENT_SECRET) return;
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
      const [member, permissions, workspaceExists] = await Promise.all([
        prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: candidate.organizationId, userId: candidate.userId } }, select: { role: true } }),
        getOrganizationRolePermissions(candidate.organizationId),
        assertWorkspaceAccess(candidate.organizationId, candidate.workspaceId),
      ]);
      if (!member || !workspaceExists || !roleCanPerformAction(member.role, "sellfox", "create", permissions)) {
        await prisma.sellfoxSyncSchedule.update({ where: { id: candidate.id }, data: { enabled: false } });
        await prisma.sellfoxSyncRun.create({ data: { id: `sellfox-sync-${randomUUID()}`, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId, userId: candidate.userId, resource: candidate.resource, status: "failed", error: "定时同步已暂停：启用计划的用户或工作区已失去有效权限。", summary: { trigger: "schedule", scheduleId: candidate.id }, finishedAt: now } });
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.id}, 0))`;
        const schedule = await tx.sellfoxSyncSchedule.findUnique({ where: { id: candidate.id } });
        if (!schedule?.enabled || !due(schedule, now)) return;
        const active = await tx.sellfoxSyncRun.findFirst({ where: { organizationId: schedule.organizationId, workspaceId: schedule.workspaceId, resource: schedule.resource, status: { in: ["queued", "running"] } } });
        if (active) return;
        const runId = `sellfox-sync-${randomUUID()}`;
        await tx.sellfoxSyncRun.create({ data: { id: runId, organizationId: schedule.organizationId, workspaceId: schedule.workspaceId, userId: schedule.userId, resource: schedule.resource, status: "queued", summary: { trigger: "schedule" } } });
        await tx.sellfoxSyncSchedule.update({ where: { id: schedule.id }, data: { lastEnqueuedAt: now } });
      });
    }
    const scheduledPending = await prisma.sellfoxSyncRun.findMany({ where: { status: "queued", summary: { path: ["trigger"], equals: "schedule" } }, orderBy: { startedAt: "asc" }, take: 50 });
    for (const run of scheduledPending) await enqueueSellfoxSyncRun(run.id);
  } finally { recovering = false; }
}

async function heartbeat(status: "online" | "stopping" = "online") {
  if (!process.env.DATABASE_URL) return;
  await prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: { id: workerId, workerName, queueName: sellfoxSyncQueueName, status, concurrency: 1, lastSeenAt: new Date(), metadata: { pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue },
    update: { status, concurrency: 1, lastSeenAt: new Date(), metadata: { pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue },
  });
}

void recoverAndSchedule().catch((error) => console.error("[sellfox-sync-worker] schedule recovery failed", error instanceof Error ? error.message : "unknown"));
const recoveryTimer = setInterval(() => void recoverAndSchedule().catch((error) => console.error("[sellfox-sync-worker] schedule tick failed", error instanceof Error ? error.message : "unknown")), 30_000);
const heartbeatTimer = setInterval(() => void heartbeat().catch((error) => console.error("[sellfox-sync-worker] heartbeat failed", error instanceof Error ? error.message : "unknown")), 30_000);
void heartbeat().catch(() => undefined);
worker.on("completed", (job) => console.log(`[sellfox-sync-worker] completed ${job.data.runId}`));
worker.on("failed", (job, error) => console.error(`[sellfox-sync-worker] failed ${job?.data.runId ?? "unknown"}: ${error.message}`));

async function shutdown() {
  clearInterval(recoveryTimer); clearInterval(heartbeatTimer);
  await heartbeat("stopping").catch(() => undefined); await worker.close(); await prisma.$disconnect(); process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
console.log(`[sellfox-sync-worker] listening on ${sellfoxSyncQueueName}`);
