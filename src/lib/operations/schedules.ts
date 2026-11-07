import { prisma } from "@/lib/db/prisma";
import { amazonReadDomains } from "./types";
import { defaultSyncIntervals, nextScheduledAt } from "./schedule-policy";

export async function getSyncSchedules(organizationId: string, workspaceId: string) {
  const rows = process.env.DATABASE_URL
    ? await prisma.amazonSyncSchedule.findMany({ where: { organizationId, workspaceId, executionVersion: 1 } }) : [];
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

// Historical schedules are read-only; policy approval never authorizes future executions.
export async function enqueueDueAmazonSchedules(...args: unknown[]) { void args; return 0; }
