import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { deriveSellfoxWatermarks } from "@/lib/sellfox/watermark";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const where = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    // 最早可查日期：供空态提示使用；查不到保留 null（不补零值、不伪造日期）。
    const [earliestSalesRow, earliestPerformanceRow] = await Promise.all([
      prisma.sellfoxSalesDailySnapshot.findFirst({ where, orderBy: { reportDate: "asc" }, select: { reportDate: true } }),
      prisma.sellfoxProductDailySnapshot.findFirst({ where: { ...where, onlySettle: false }, orderBy: { reportDate: "asc" }, select: { reportDate: true } }),
    ]);
    const [stores, hourlyCount, inventoryCount, salesCount, performanceCount, inventoryCoverage, salesCoverage, latestRun, latestHourlyRun, latestPerformanceRun, latestMetric, latestRuns, latestSuccessRuns, heartbeat] = await Promise.all([
      prisma.sellfoxStore.findMany({ where, select: { id: true, externalId: true, name: true, marketplace: true, country: true, status: true, lastSyncedAt: true }, orderBy: { name: "asc" } }),
      prisma.sellfoxHourlyMetric.count({ where }),
      prisma.sellfoxFbaInventorySnapshot.count({ where }),
      prisma.sellfoxSalesDailySnapshot.count({ where }),
      prisma.sellfoxProductDailySnapshot.count({ where: { ...where, onlySettle: false } }),
      prisma.sellfoxFbaInventorySnapshot.findMany({ where, distinct: ["storeId"], select: { storeId: true } }),
      prisma.sellfoxSalesDailySnapshot.findMany({ where, distinct: ["storeId"], select: { storeId: true } }),
      prisma.sellfoxSyncRun.findFirst({ where, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "hourly", status: "done" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "performance" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxHourlyMetric.findFirst({ where, orderBy: { syncedAt: "desc" } }),
      prisma.sellfoxSyncRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true } }),
      Promise.all(["stores", "inventory", "sales", "performance", "hourly"].map((resource) => prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource, status: "done" }, orderBy: { startedAt: "desc" }, select: { id: true, resource: true, status: true, summary: true, error: true, startedAt: true, finishedAt: true } }))),
      prisma.workerHeartbeat.findFirst({ where: { queueName: "sellfox-sync-jobs", status: "online", lastSeenAt: { gte: new Date(Date.now() - 90_000) } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, lastSeenAt: true } }),
    ]);

    return NextResponse.json({
      configured: (await getSellfoxCredentialStatus(where)).configured,
      stores,
      hourlyCount,
      counts: { stores: stores.length, inventory: inventoryCount, sales: salesCount, performance: performanceCount, hourly: hourlyCount },
      coverage: { inventoryStores: inventoryCoverage.length, inventoryMissingStores: Math.max(0, stores.length - inventoryCoverage.length), salesStores: salesCoverage.length, salesMissingStores: Math.max(0, stores.length - salesCoverage.length) },
      latestRuns,
      latestSuccessByResource: Object.fromEntries(latestSuccessRuns.filter((run) => run !== null).map((run) => [run.resource, run])),
      workerOnline: Boolean(heartbeat),
      latestRun,
      latestPerformanceRun,
      nextHourlyStoreOffset: (() => {
        const summary = latestHourlyRun?.summary as { storeOffset?: unknown; storeLimit?: unknown } | null;
        return Math.max(0, Number(summary?.storeOffset) || 0) + Math.max(1, Number(summary?.storeLimit) || 1);
      })(),
      latestMetricAt: latestMetric?.syncedAt ?? null,
      // 三元组水位线（resource × 店铺）可观测样本，派生自最近成功 run；不参与游标推进。
      watermarks: Array.from(deriveSellfoxWatermarks(latestRuns).entries()).map(([key, value]) => {
        const [resource, shopExternalId] = key.split("\u0000");
        return { resource, shopExternalId, lastSuccessAt: value.lastSuccessAt?.toISOString() ?? null, lastReportDate: value.lastReportDate };
      }),
      earliestReportDate: {
        sales: earliestSalesRow?.reportDate ?? null,
        performance: earliestPerformanceRow?.reportDate ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: "读取赛狐概览失败，请稍后重试。" }, { status: 500 });
  }
}
