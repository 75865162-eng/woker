import { prisma } from "@/lib/db/prisma";
import { enabledSyncScopes } from "./scheduler";
import { scopeLock } from "./service";

let lastMaintenance = 0;
let scanCursor: { finishedAt: Date; id: string } | null = null;
/** Bounded cleanup, never deletes a current snapshot or a replenishment input reference. */
export async function maintainSyncCenter(now = new Date()) {
  if (now.getTime() - lastMaintenance < 3600000) return;
  const scopes = enabledSyncScopes(); if (!scopes.length) return;
  const candidates = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, executionVersion: 2, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED"] }, stage: { not: "PURGED" }, ...(scanCursor ? { AND: [{ OR: [{ finishedAt: { gt: scanCursor.finishedAt } }, { finishedAt: scanCursor.finishedAt, id: { gt: scanCursor.id } }] }] } : {}), finishedAt: { lt: new Date(now.getTime() - 86400000) } }, orderBy: [{ finishedAt: "asc" }, { id: "asc" }], take: 100 });
  let cleaned = 0;
  for (const task of candidates) {
    if (cleaned >= 10) break;
    // Rotate past protected heads and long-retention plans instead of starving later candidates.
    if (task.finishedAt) scanCursor = { finishedAt: task.finishedAt, id: task.id };
    const plan = task.scheduleId ? await prisma.amazonSyncSchedule.findFirst({ where: { id: task.scheduleId, organizationId: task.organizationId, workspaceId: task.workspaceId }, select: { retentionDays: true } }) : null;
    const keepDays = plan?.retentionDays ?? 30;
    if (!task.finishedAt || now.getTime() - task.finishedAt.getTime() < keepDays * 86400000) continue;
    await prisma.$transaction(async tx => {
      await scopeLock(tx, task);
      const scope = { organizationId: task.organizationId, workspaceId: task.workspaceId };
      const live = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: task.id, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED"] } } });
      if (!live || live.stage === "PURGED") return;
      if (await tx.amazonSyncDataSource.count({ where: { ...scope, activeRunId: task.id } })) return;
      if (await tx.amazonReplenishmentPlan.count({ where: { ...scope, inventoryRunId: task.id } })) return;
      await tx.amazonInventorySnapshot.deleteMany({ where: { ...scope, syncRunId: task.id } });
      await tx.amazonCatalogSnapshot.deleteMany({ where: { ...scope, sourceRunId: task.id } });
      await tx.amazonSyncPage.deleteMany({ where: { ...scope, taskId: task.id } });
      await tx.amazonSyncTaskLog.deleteMany({ where: { ...scope, taskId: task.id } });
      await tx.amazonSyncRun.update({ where: { id: task.id }, data: { stage: "PURGED", checkpointCiphertext: null } });
      await tx.auditLog.create({ data: { organizationId: task.organizationId, userId: task.requestedByUserId, action: "amazon.sync.retention.cleaned", entityType: "AmazonSyncRun", entityId: task.id, metadata: { workspaceId: task.workspaceId, retainedTaskSummary: true, keepDays } } });
      cleaned++;
    });
  }
  if (!candidates.length) scanCursor = null;
  lastMaintenance = now.getTime();
}
