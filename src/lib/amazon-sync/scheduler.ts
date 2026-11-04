import { assertExecutionWindow } from "./execution-window";
import { dispatchSalesExports } from "./exports";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { scopeLock } from "./service";
import { type SyncScope } from "./policy";

export function enabledSyncScopes(value = process.env.AMAZON_SYNC_CENTER_SCOPES): SyncScope[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is [string, string] => Array.isArray(r) && r.length === 2 && r.every(v => typeof v === "string" && v.length > 0 && v.length < 201)).map(([organizationId, workspaceId]) => ({ organizationId, workspaceId }));
  } catch { return []; }
}
export async function tickSyncCenter(now = new Date(), only?: { taskIds: string[]; exportIds: string[] }) {
  const scopes = enabledSyncScopes();
  if (!scopes.length || !process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return;
  await dispatchSalesExports(scopes, only?.exportIds);
  // An approved policy never grants future execution authority.
  const expired = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: "RUNNING", leaseExpiresAt: { lt: now } }, take: 100 });
  for (const run of expired) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, run);
      const changed = await tx.amazonSyncRun.updateMany({ where: { id: run.id, status: "RUNNING", fenceVersion: run.fenceVersion, leaseExpiresAt: { lt: now } }, data: { status: run.attempts >= run.maxAttempts ? "FAILED" : "RETRY_WAIT", stage: run.stage, fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: run.attempts >= run.maxAttempts ? now : null, error: "任务租约过期；从已提交分页检查点恢复，旧执行器不能发布。" } });
      if (changed.count) await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "LEASE_EXPIRED", stage: run.stage, code: "INTERRUPTED" } });
    });
  }
  const pending = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date(Math.max(now.getTime(), Date.now())) } }, orderBy: [{ priority: "asc" }, { nextAttemptAt: "asc" }], take: 100 });
  for (const run of pending) {
    try {
      try { assertExecutionWindow(run.frozenScope, now); } catch {
        await prisma.amazonSyncRun.updateMany({ where: { id: run.id, dispatchVersion: run.dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: "执行授权已过期或缺少截止时间，须重新审批。", finishedAt: now, dispatchVersion: { increment: 1 } } });
        continue;
      }
      const grant = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { id: run.executionApprovalId ?? "", organizationId: run.organizationId, workspaceId: run.workspaceId, status: "APPLIED", changeType: "SyncExecutionRequest", OR: [{ operation: "run" }, { operation: "control-task", targetId: run.id }], sourceIds: { has: run.sourceId ?? "" } }, select: { id: true } });
      if (!grant) {
        await prisma.amazonSyncRun.updateMany({ where: { id: run.id, dispatchVersion: run.dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: "执行审批缺失、过期或已撤销。", finishedAt: now, dispatchVersion: { increment: 1 } } });
        continue;
      }
      // DB intent survives Redis loss; generation fences cancelled/old queue jobs.
      await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: run.id, dispatchVersion: run.dispatchVersion }, { jobId: `adc-${run.id}-${run.dispatchVersion}`, priority: run.priority, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await prisma.amazonSyncRun.updateMany({ where: { id: run.id, status: "WAITING", dispatchVersion: run.dispatchVersion }, data: { status: "QUEUED" } });
    } catch { console.error(`[amazon-sync-center] task ${run.id} dispatch deferred; intent retained`); }
  }
}
