import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { performanceQuery } from "@/lib/sellfox/performance-query";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view");
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 50, 1), 200);
    const where = performanceQuery(url, permission.user.organizationId, scope.workspaceId);
    const [total, rows, summary] = await Promise.all([
      prisma.sellfoxProductDailySnapshot.count({ where }),
      prisma.sellfoxProductDailySnapshot.findMany({ where, include: { store: { select: { name: true, externalId: true } } }, orderBy: { saleRevenue: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.sellfoxProductDailySnapshot.aggregate({ where, _sum: { saleQuantity: true, saleRevenue: true, grossProfit: true, adCost: true } }),
    ]);
    return NextResponse.json({ rows, pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }, summary: summary._sum });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取赛狐产品表现失败。" }, { status: 500 });
  }
}
