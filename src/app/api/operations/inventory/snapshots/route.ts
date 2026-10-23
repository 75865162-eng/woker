import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { buildInventorySnapshotWhere, parseInventorySnapshotFilters } from "@/lib/operations/read-models";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const filters = parseInventorySnapshotFilters(new URL(request.url).searchParams);
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        rows: [],
        pagination: { page: filters.page, pageSize: filters.pageSize, total: 0, pageCount: 0 },
        snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null },
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const latestRun = await prisma.amazonSyncRun.findFirst({
      where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, resource: "inventory", status: "SUCCEEDED" },
      select: { id: true },
      orderBy: { finishedAt: "desc" },
    });
    if (!latestRun) {
      return NextResponse.json({
        rows: [],
        pagination: { page: filters.page, pageSize: filters.pageSize, total: 0, pageCount: 0 },
        snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const where = buildInventorySnapshotWhere({
      organizationId: permission.user.organizationId,
      workspaceId: scope.workspaceId,
      syncRunId: latestRun.id,
      sku: filters.sku,
    });
    const [total, rows, latestSnapshot] = await Promise.all([
      prisma.amazonInventorySnapshot.count({ where }),
      prisma.amazonInventorySnapshot.findMany({
        where,
        orderBy: { sellerSku: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.amazonInventorySnapshot.findFirst({
        where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, syncRunId: latestRun.id },
        select: { capturedAt: true },
        orderBy: { capturedAt: "desc" },
      }),
    ]);
    const capturedAt = latestSnapshot?.capturedAt ?? null;
    return NextResponse.json({
      rows,
      pagination: { page: filters.page, pageSize: filters.pageSize, total, pageCount: Math.ceil(total / filters.pageSize) },
      snapshot: {
        status: inventorySnapshotStatus(capturedAt),
        syncRunId: latestRun.id,
        capturedAt: capturedAt?.toISOString() ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "库存快照读取失败。" }, { status: 500 });
  }
}
