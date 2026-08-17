import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

const sellfoxProductWhere = {
  OR: [
    { id: { startsWith: "sellfox-", mode: "insensitive" as const } },
    {
      payload: {
        path: ["note"],
        string_contains: "赛狐在线产品 API",
        mode: "insensitive" as const,
      },
    },
  ],
};

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(request, "sellfox", "view");
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const where = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    const [stores, productCount, hourlyCount, latestRun, latestHourlyRun, latestPerformanceRun, latestMetric] = await Promise.all([
      prisma.sellfoxStore.findMany({ where, orderBy: { name: "asc" } }),
      prisma.productRecord.count({ where: { ...where, ...sellfoxProductWhere } }),
      prisma.sellfoxHourlyMetric.count({ where }),
      prisma.sellfoxSyncRun.findFirst({ where, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "hourly", status: "done" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxSyncRun.findFirst({ where: { ...where, resource: "performance" }, orderBy: { startedAt: "desc" } }),
      prisma.sellfoxHourlyMetric.findFirst({ where, orderBy: { syncedAt: "desc" } }),
    ]);

    return NextResponse.json({
      configured: Boolean(process.env.SELLFOX_CLIENT_ID && process.env.SELLFOX_CLIENT_SECRET),
      stores,
      productCount,
      hourlyCount,
      latestRun,
      latestPerformanceRun,
      nextHourlyStoreOffset: (() => {
        const summary = latestHourlyRun?.summary as { storeOffset?: unknown; storeLimit?: unknown } | null;
        return Math.max(0, Number(summary?.storeOffset) || 0) + Math.max(1, Number(summary?.storeLimit) || 1);
      })(),
      latestMetricAt: latestMetric?.syncedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load Sellfox overview." }, { status: 500 });
  }
}
