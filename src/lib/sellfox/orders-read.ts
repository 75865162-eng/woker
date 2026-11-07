import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { sellfoxStoreSyncFailures } from "./sync-failures";

type Scope = { organizationId: string; workspaceId: string };

function searchWhere(query: SellfoxBrowseQuery): Prisma.SellfoxOrderSnapshotWhereInput {
  if (!query.search) return {};
  const fields = query.searchType === "order" ? ["orderId"] : query.searchType === "asin" ? ["asin"] : query.searchType === "msku" ? ["msku"] : query.searchType === "sku" ? ["sku"] : ["orderId", "sellerOrderId", "asin", "msku", "sku"];
  const match = query.exactMatch ? { equals: query.search, mode: "insensitive" as const } : { contains: query.search, mode: "insensitive" as const };
  return { OR: fields.map((field) => ({ [field]: match })) };
}

export async function readSellfoxOrders(query: SellfoxBrowseQuery, scope: Scope, storeIds?: string[]) {
  const where: Prisma.SellfoxOrderSnapshotWhereInput = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(storeIds ? { storeId: { in: storeIds } } : {}),
    ...(query.from || query.to ? { purchaseDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
    ...(query.status ? { orderStatus: query.status } : {}),
    ...(query.fulfillment ? { fulfillmentChannel: query.fulfillment } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.site ? { SellfoxStore: { marketplace: query.site } } : {}),
    ...searchWhere(query),
  };
  const [total, lines, statuses, failures, qty] = await Promise.all([
    prisma.sellfoxOrderSnapshot.count({ where }),
    prisma.sellfoxOrderSnapshot.findMany({
      where,
      orderBy: [{ purchaseDate: "desc" }, { orderId: "asc" }, { lineKey: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { SellfoxStore: { select: { name: true, marketplace: true, externalId: true } } },
    }),
    prisma.sellfoxOrderSnapshot.findMany({ where: { ...where, orderStatus: undefined }, distinct: ["orderStatus"], select: { orderStatus: true }, orderBy: { orderStatus: "asc" }, take: 50 }),
    sellfoxStoreSyncFailures("orders", scope),
    prisma.sellfoxOrderSnapshot.aggregate({ where, _sum: { qty: true }, _count: { qty: true } }),
  ]);
  const rows = lines.map((line) => ({
    id: line.id,
    store: [line.SellfoxStore.name, line.SellfoxStore.marketplace].filter(Boolean).join(" / "),
    name: line.SellfoxStore.name,
    marketplace: line.SellfoxStore.marketplace,
    shopExternalId: line.shopExternalId,
    orderId: line.orderId,
    sellerOrderId: line.sellerOrderId,
    purchaseAt: line.purchaseDateRaw ?? line.purchaseDate,
    payAt: line.payAt,
    refundAt: line.refundAt,
    status: line.orderStatus,
    revenue: line.revenue,
    asin: line.asin,
    msku: line.msku,
    sku: line.sku,
    qty: line.qty,
    refundQty: line.refundQty,
    promo: line.promo,
    amount: line.itemAmount,
    currency: line.currency,
    profit: line.revenue,
    shipServiceLevel: line.shipServiceLevel,
    fulfillmentChannel: line.fulfillmentChannel,
  }));
  return {
    rows,
    totals: [{ qty: total > 0 && qty._count.qty === total ? qty._sum.qty : null }],
    facets: { productTags: [] as string[], salespersons: [] as string[], statuses: statuses.map((row) => row.orderStatus).filter(Boolean) },
    pagination: { page: query.page, pageSize: query.pageSize, total },
    failures,
  };
}
