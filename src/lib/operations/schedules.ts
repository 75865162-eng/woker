import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { amazonReadDomains } from "./types";
import { defaultSyncIntervals, nextScheduledAt } from "./schedule-policy";

export async function getSyncSchedules(organizationId: string, workspaceId: string) {
  const rows = process.env.DATABASE_URL
    ? await prisma.amazonSyncSchedule.findMany({ where: { organizationId, workspaceId } }) : [];
  return amazonReadDomains.map((resource) => {
    const row = rows.find((item) => item.resource === resource);
    return {
      resource, enabled: row?.enabled ?? false,
      intervalMinutes: row?.intervalMinutes ?? defaultSyncIntervals[resource],
      lastEnqueuedAt: row?.lastEnqueuedAt?.toISOString() ?? null,
      nextScheduledAt: row ? nextScheduledAt(row)?.toISOString() ?? null : null,
      supported: resource === "inventory" || resource === "catalog",
      source: resource === "ads" ? "sourced_from_ppc" : "amazon_sp_api",
    };
  });
}

// The scheduler only records runs. Queue recovery dispatches them to the existing worker.
export async function enqueueDueAmazonSchedules(now = new Date()) {
  if (!process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return 0;
  const due = await prisma.amazonSyncSchedule.findMany({
    where: { enabled: true, resource: { in: ["inventory", "catalog"] } }, orderBy: { lastEnqueuedAt: "asc" }, take: 100,
  });
  let enqueued = 0;
  for (const candidate of due) {
    if ((nextScheduledAt(candidate)?.getTime() ?? Infinity) > now.getTime()) continue;
    enqueued += await prisma.$transaction(async (tx) => {
      // Serializes concurrent scheduler instances; re-read after acquiring the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.id}, 0))`;
      const schedule = await tx.amazonSyncSchedule.findUnique({ where: { id: candidate.id } });
      if (!schedule?.enabled || (nextScheduledAt(schedule)?.getTime() ?? Infinity) > now.getTime()) return 0;
      const scopeKey = JSON.stringify(["enqueue", schedule.organizationId, schedule.workspaceId, schedule.resource]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
      const active = await tx.amazonSyncRun.findFirst({ where: {
        organizationId: schedule.organizationId, workspaceId: schedule.workspaceId,
        resource: schedule.resource, status: { in: ["QUEUED", "RUNNING"] },
      } });
      if (active) return 0;
      const dueAt = nextScheduledAt(schedule)!;
      await tx.amazonSyncRun.create({ data: {
        id: `amazon-sync-${randomUUID()}`, organizationId: schedule.organizationId,
        workspaceId: schedule.workspaceId, requestedByUserId: schedule.updatedByUserId,
        resource: schedule.resource, status: "QUEUED",
        idempotencyKey: `schedule:${schedule.id}:${dueAt.getTime()}`,
        summary: { trigger: "schedule", scheduleId: schedule.id, externalRequestAttempted: false },
      } });
      await tx.amazonSyncSchedule.update({ where: { id: schedule.id }, data: { lastEnqueuedAt: now } });
      return 1;
    });
  }
  return enqueued;
}
