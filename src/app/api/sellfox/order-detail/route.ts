import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxBrowseStoreIds } from "@/lib/sellfox/browse-store-scope";
import { moneyToNumber } from "@/lib/sellfox/money-display";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

/** 订单详情只读承接：一行一个订单，字段来自 /api/order/detailByOrderIds.json 原始响应。 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const scope = workspaceScopeFromRequest(request);
  const query = sellfoxBrowseQuery(new URL(request.url));
  const common = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId };
  const storeIds = await sellfoxBrowseStoreIds(query, common.organizationId, common.workspaceId);
  const where: Prisma.SellfoxOrderDetailWhereInput = {
    ...common,
    ...(storeIds ? { storeId: { in: storeIds } } : {}),
    ...(query.from || query.to ? { purchaseDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    ...(query.status ? { orderStatus: query.status } : {}),
    ...(query.site ? { SellfoxStore: { marketplace: query.site } } : {}),
    ...(query.search ? { OR: [
      { sellerOrderId: { contains: query.search, mode: "insensitive" } },
      { amazonOrderId: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const [total, rows, statuses] = await Promise.all([
    prisma.sellfoxOrderDetail.count({ where }),
    prisma.sellfoxOrderDetail.findMany({
      where,
      orderBy: [{ purchaseDate: "desc" }, { sellerOrderId: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { SellfoxStore: { select: { name: true, marketplace: true, externalId: true } } },
    }),
    prisma.sellfoxOrderDetail.findMany({ where: { ...common, orderStatus: { not: null } }, distinct: ["orderStatus"], select: { orderStatus: true }, orderBy: { orderStatus: "asc" }, take: 50 }),
  ]);
  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      store: row.SellfoxStore.name,
      marketplace: row.SellfoxStore.marketplace,
      shopExternalId: row.shopExternalId,
      sellerOrderId: row.sellerOrderId,
      amazonOrderId: row.amazonOrderId,
      status: row.orderStatus,
      purchaseDate: row.purchaseDate,
      paymentsDate: row.paymentsDate,
      currency: row.orderTotalCurrency,
      orderTotal: moneyToNumber(row.orderTotalAmount),
      productAmount: moneyToNumber(row.productAmount),
      commission: moneyToNumber(row.commission),
      fbaFee: moneyToNumber(row.fbaPerUnitFulfillmentFee),
      purchaseCost: moneyToNumber(row.purchaseCost),
      orderProfit: moneyToNumber(row.orderProfit),
      totalCost: moneyToNumber(row.totalCost),
      refundPrice: moneyToNumber(row.refundPrice),
      settlementStatus: row.settlementStatus,
      fulfillmentChannel: row.fulfillmentChannel,
      payload: row.payload,
      latestCapturedAt: row.latestCapturedAt,
    })),
    facets: { statuses: statuses.map((row) => row.orderStatus).filter(Boolean) },
    pagination: { page: query.page, pageSize: query.pageSize, total },
  });
}
