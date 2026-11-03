import { publishedSnapshotScopes, inventoryPublishedWhere, oldestSnapshot } from "@/lib/amazon-sync/read";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { inventorySnapshotStatus } from "@/lib/operations/readiness";
import { parseInventorySnapshotFilters } from "@/lib/operations/read-models";
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
    const tenantScope = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
    const heads = await publishedSnapshotScopes(tenantScope, "inventory");
    if (!heads.length) {
      return NextResponse.json({
        rows: [],
        pagination: { page: filters.page, pageSize: filters.pageSize, total: 0, pageCount: 0 },
        snapshot: { status: "NOT_SYNCED", syncRunId: null, capturedAt: null },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const where = { ...inventoryPublishedWhere(tenantScope, heads),
      ...(filters.sku ? { sellerSku: { contains: filters.sku, mode: "insensitive" as const } } : {}) };
    const [total, rows] = await Promise.all([
      prisma.amazonInventorySnapshot.count({ where }),
      prisma.amazonInventorySnapshot.findMany({
        where,
        orderBy: { sellerSku: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    const capturedAt = oldestSnapshot(heads);
    return NextResponse.json({
      rows,
      pagination: { page: filters.page, pageSize: filters.pageSize, total, pageCount: Math.ceil(total / filters.pageSize) },
      snapshot: {
        status: heads.some(h => inventorySnapshotStatus(h.capturedAt, new Date(), h.freshnessMinutes) !== "FRESH") ? "STALE" : "FRESH",
        syncRunId: heads.length === 1 ? heads[0].runId : null,
        capturedAt: capturedAt?.toISOString() ?? null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "库存快照读取失败。" }, { status: 500 });
  }
}
