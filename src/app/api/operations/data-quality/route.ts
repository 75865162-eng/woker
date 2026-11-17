import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { bucketLatency, buildReconciliationTrend, computeNullRate } from "@/lib/operations/data-quality";

export const runtime = "nodejs";

/**
 * 数据质量只读视图（审计 6.4）。
 * 只统计当前组织 + workspace 的现有快照数据，不改 schema、不触发同步、不回源平台。
 * 空值率分母为 0 时保留 null；对账趋势仅展示已结构化字段，真实结论须预发完成。
 */
export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const where = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };

    const [salesTotal, salesRevenueNull, salesOrdersNull, perfTotal, perfNetRevenueNull, perfImageNull, invTotal, invQuantityNull, doneRuns] = await Promise.all([
      prisma.sellfoxSalesDailySnapshot.count({ where }),
      prisma.sellfoxSalesDailySnapshot.count({ where: { ...where, revenue: null } }),
      prisma.sellfoxSalesDailySnapshot.count({ where: { ...where, orders: null } }),
      prisma.sellfoxProductDailySnapshot.count({ where: { ...where, onlySettle: false } }),
      prisma.sellfoxProductDailySnapshot.count({ where: { ...where, onlySettle: false, netRevenue: null } }),
      prisma.sellfoxProductDailySnapshot.count({ where: { ...where, onlySettle: false, imageUrl: null } }),
      prisma.sellfoxFbaInventorySnapshot.count({ where }),
      prisma.sellfoxFbaInventorySnapshot.count({ where: { ...where, quantity: null } }),
      prisma.sellfoxSyncRun.findMany({
        where: { ...where, status: "done" },
        orderBy: { finishedAt: "asc" },
        take: 200,
        select: { resource: true, summary: true, startedAt: true, finishedAt: true },
      }),
    ]);

    const durations = doneRuns
      .filter((run) => run.finishedAt)
      .map((run) => (run.finishedAt as Date).getTime() - run.startedAt.getTime());

    return NextResponse.json({
      nullRates: {
        sales: {
          revenue: computeNullRate(salesTotal, salesRevenueNull),
          orders: computeNullRate(salesTotal, salesOrdersNull),
        },
        performance: {
          netRevenue: computeNullRate(perfTotal, perfNetRevenueNull),
          imageUrl: computeNullRate(perfTotal, perfImageNull),
        },
        inventory: {
          quantity: computeNullRate(invTotal, invQuantityNull),
        },
      },
      syncLatency: bucketLatency(durations),
      reconciliationTrend: buildReconciliationTrend(doneRuns),
      note: "空值率基于当前 workspace 现有快照统计；对账趋势仅展示已结构化字段，真实三方对账须在预发完成。",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "读取质量指标失败，请稍后重试。" }, { status: 500 });
  }
}
