import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createTask, scopeLock, assertLegacyDrained } from "./service";
import { syncCenterEnabled, type SyncScope } from "./policy";

export function enabledSyncScopes(value = process.env.AMAZON_SYNC_CENTER_SCOPES): SyncScope[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is [string, string] => Array.isArray(r) && r.length === 2 && r.every(v => typeof v === "string" && v.length > 0 && v.length < 201)).map(([organizationId, workspaceId]) => ({ organizationId, workspaceId }));
  } catch { return []; }
}
export async function tickSyncCenter(now = new Date()) {
  const scopes = enabledSyncScopes();
  if (!scopes.length || !process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return;
  const plans = await prisma.amazonSyncSchedule.findMany({ where: { OR: scopes, executionVersion: 2, enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 100 });
  for (const plan of plans) {
    try {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, plan); await assertLegacyDrained(tx, plan);
        const live = await tx.amazonSyncSchedule.findUniqueOrThrow({ where: { id: plan.id } });
        if (!live.enabled || !live.nextRunAt || live.nextRunAt > now || live.revision !== plan.revision || !syncCenterEnabled(live)) return;
        const targets = await tx.amazonSyncPlanTarget.findMany({ where: { organizationId: live.organizationId, workspaceId: live.workspaceId, scheduleId: live.id } });
        for (const target of targets) {
          const key = `schedule:${live.id}:${live.nextRunAt.getTime()}:${target.sourceId}`;
          try { await createTask(tx, live, live.updatedByUserId, target.sourceId, { key, trigger: "schedule", scheduleId: live.id, scheduleRevision: live.revision, maxAttempts: live.maxAttempts, priority: live.priority }); }
          catch (error) {
            // Only an expected domain/configuration rejection becomes BLOCKED. DB errors abort.
            if (!(error instanceof Error) || error.name !== "SyncInputError") throw error;
            await tx.amazonSyncRun.create({ data: { id: randomUUID(), organizationId: live.organizationId, workspaceId: live.workspaceId, sourceId: target.sourceId, requestedByUserId: live.updatedByUserId, resource: live.resource, executionVersion: 2, scheduleId: live.id, scheduleRevision: live.revision, trigger: "schedule", idempotencyKey: key, status: "BLOCKED", error: "计划目标已停用或授权不可用，请检查店铺、站点与授权。", finishedAt: now } });
          }
        }
        // Coalesce missed cycles, rather than enqueue every missed interval.
        await tx.amazonSyncSchedule.update({ where: { id: live.id }, data: { lastEnqueuedAt: now, nextRunAt: new Date(now.getTime() + live.intervalMinutes * 60000) } });
      });
    } catch { console.error(`[amazon-sync-center] schedule ${plan.id} could not advance; retained for recovery`); }
  }
  const expired = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, executionVersion: 2, status: "RUNNING", leaseExpiresAt: { lt: now } }, take: 100 });
  for (const run of expired) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, run);
      const changed = await tx.amazonSyncRun.updateMany({ where: { id: run.id, status: "RUNNING", fenceVersion: run.fenceVersion, leaseExpiresAt: { lt: now } }, data: { status: run.attempts >= run.maxAttempts ? "FAILED" : "RETRY_WAIT", stage: run.stage, fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: run.attempts >= run.maxAttempts ? now : null, error: "任务租约过期；从已提交分页检查点恢复，旧执行器不能发布。" } });
      if (changed.count) await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "LEASE_EXPIRED", stage: run.stage, code: "INTERRUPTED" } });
    });
  }
  const pending = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, executionVersion: 2, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date(Math.max(now.getTime(), Date.now())) } }, orderBy: [{ priority: "asc" }, { nextAttemptAt: "asc" }], take: 100 });
  for (const run of pending) {
    try {
      // DB intent survives Redis loss; generation fences cancelled/old queue jobs.
      await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: run.id, dispatchVersion: run.dispatchVersion }, { jobId: `amazon-v2-${run.id}-${run.dispatchVersion}`, priority: run.priority, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await prisma.amazonSyncRun.updateMany({ where: { id: run.id, status: "WAITING", dispatchVersion: run.dispatchVersion }, data: { status: "QUEUED" } });
    } catch { console.error(`[amazon-sync-center] task ${run.id} dispatch deferred; intent retained`); }
  }
}
