import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { prisma } from "@/lib/db/prisma";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { adsScopeEnabled, adsSyncScopes } from "./sync-policy";
import { ensureSpReportTasksForPlan, nextReportTaskForProfile, spReportPipelineEnabled, spReportTrigger } from "./report-service";

export type ReportTickResult = {
  outcome: "scanned" | "skipped";
  reason?: string;
  ensuredPlans: number;
  enqueued: number;
  deferred: number;
};

/**
 * 报表调度：先按计划补齐五类任务，再为每个 Profile 只投递一份。
 * 官方限制每个广告主账号同时 1 份报表，因此同一 Profile 串行，其余保持 WAITING。
 */
export async function tickAmazonAdsReports(now = new Date()): Promise<ReportTickResult> {
  const empty = { ensuredPlans: 0, enqueued: 0, deferred: 0 };
  if (!spReportPipelineEnabled()) return { outcome: "skipped", reason: "REPORTING_OFF", ...empty };
  if (!amazonCloudExecutionEnabled()) return { outcome: "skipped", reason: "CLOUD_EXECUTION_REQUIRED", ...empty };
  if (!process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return { outcome: "skipped", reason: "QUEUE_NOT_CONFIGURED", ...empty };
  const configured = adsSyncScopes();
  const plans = await prisma.amazonAdsSyncPlan.findMany({
    where: {
      ...(configured.length ? { OR: configured } : {}),
      status: "ACTIVE",
      profile: { sellerAccountId: { not: null }, authorization: { status: "CONNECTED" } },
    },
    select: { id: true, organizationId: true, workspaceId: true, profileId: true, reportLookbackDays: true },
    take: 200,
  });
  let ensuredPlans = 0, enqueued = 0, deferred = 0;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const plan of plans) {
    const scope = { organizationId: plan.organizationId, workspaceId: plan.workspaceId };
    if (!adsScopeEnabled(scope)) continue;
    try {
      const todaysTasks = await prisma.amazonAdsSyncTask.count({ where: { ...scope, planId: plan.id, trigger: spReportTrigger, createdAt: { gte: dayStart } } });
      if (todaysTasks < 5) {
        await ensureSpReportTasksForPlan(scope, plan.id, now);
        ensuredPlans += 1;
      }
      const next = await nextReportTaskForProfile(scope, plan.profileId, now);
      if (!next) { deferred += 1; continue; }
      try {
        await getAmazonSyncQueue().add(
          "process-amazon-ads-report-task",
          { runId: next.id, adsReportTaskId: next.id, adsReportDispatchVersion: next.dispatchVersion },
          { jobId: `ads-report-${next.id}-${next.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
        await prisma.amazonAdsSyncTask.updateMany({ where: { ...scope, id: next.id, dispatchVersion: next.dispatchVersion, status: { in: ["WAITING", "RETRY_WAIT"] } }, data: { status: "QUEUED" } });
        enqueued += 1;
      } catch {
        deferred += 1;
      }
    } catch {
      deferred += 1;
    }
  }
  return { outcome: "scanned", ensuredPlans, enqueued, deferred };
}
