import { resolveEffectiveReportDate } from "@/lib/sellfox/browse-report-date";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { sellfoxBrowseQuery, sellfoxSnapshotWhere, SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;

    const scope = workspaceScopeFromRequest(request);
    const url = new URL(request.url);
    let query = sellfoxBrowseQuery(url); const { page, pageSize } = query;
    const storeIds = await sellfoxBrowseStoreIds(query, permission.user.organizationId, scope.workspaceId);
    if (query.layout) return NextResponse.json(await readSellfoxWorkbench("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId }));
    query = await resolveEffectiveReportDate("performance", query, { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId });
    const where = sellfoxSnapshotWhere(query, permission.user.organizationId, scope.workspaceId, storeIds, true);
    const [total, rows, summary] = await Promise.all([
      prisma.sellfoxProductDailySnapshot.count({ where }),
      prisma.sellfoxProductDailySnapshot.findMany({
        where,
        select: { id: true, reportDate: true, sku: true, msku: true, asin: true, title: true, currency: true, saleQuantity: true, fbaQuantity: true, fbmQuantity: true, saleRevenue: true, grossProfit: true, grossProfitRate: true, adCost: true, refundRate: true, orderNum: true, netRevenue: true, syncedAt: true, SellfoxStore: { select: { name: true, externalId: true, marketplace: true } } },
        orderBy: [{ saleRevenue: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sellfoxProductDailySnapshot.aggregate({ where, _sum: { saleQuantity: true, saleRevenue: true, grossProfit: true, adCost: true } }),
    ]);
    return NextResponse.json({ rows, dates: query.reportDate && !query.from && !query.to ? [query.reportDate] : [], pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }, summary: summary._sum });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "读取赛狐产品表现失败，请稍后重试。" }, { status: error instanceof SellfoxBrowseError ? error.status : 500 });
  }
}
