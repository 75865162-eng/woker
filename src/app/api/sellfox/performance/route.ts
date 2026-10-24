import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { performanceQuery } from "@/lib/sellfox/performance-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function parseOptionalNumber(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const url = new URL(request.url);
    const page = Math.max(parseOptionalNumber(url.searchParams.get("page")) ?? 1, 1);
    const pageSize = Math.min(Math.max(parseOptionalNumber(url.searchParams.get("pageSize")) ?? 50, 1), 200);
    const where = performanceQuery(url, permission.user.organizationId, scope.workspaceId);
    const shopExternalIds = url.searchParams.getAll("shopExternalId").filter(Boolean);
    if (shopExternalIds.length) {
      const stores = await prisma.sellfoxStore.findMany({ where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, externalId: { in: shopExternalIds } }, select: { id: true } });
      if (stores.length !== shopExternalIds.length) return NextResponse.json({ error: "店铺不属于当前工作区。" }, { status: 403 });
      where.storeId = { in: stores.map((store) => store.id) };
    }
    const [total, rows, summary] = await Promise.all([
      prisma.sellfoxProductDailySnapshot.count({ where }),
      prisma.sellfoxProductDailySnapshot.findMany({
        where,
        select: { id: true, reportDate: true, sku: true, msku: true, asin: true, title: true, currency: true, saleQuantity: true, fbaQuantity: true, fbmQuantity: true, saleRevenue: true, grossProfit: true, grossProfitRate: true, adCost: true, refundRate: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } },
        orderBy: { saleRevenue: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sellfoxProductDailySnapshot.aggregate({ where, _sum: { saleQuantity: true, saleRevenue: true, grossProfit: true, adCost: true } }),
    ]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }, summary: summary._sum });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取赛狐产品表现失败。" }, { status: 500 });
  }
}
