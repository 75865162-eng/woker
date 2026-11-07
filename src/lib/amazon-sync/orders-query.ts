import { queryPageSize } from "./query-page";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere, type AmazonDataAccess } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";
import { digest } from "./approval-policy";

export function orderReadWhere(scope: SyncScope, params: URLSearchParams, access: AmazonDataAccess): Prisma.AmazonOrderRecordWhereInput {
  const filters: Prisma.AmazonOrderRecordWhereInput = {};
  for (const key of ["sellerAccountId", "marketplaceId", "sourceId", "amazonOrderId", "rawStatus"] as const) {
    const value = params.get(key);
    if (value) { if (value.length > 200) throw new SyncInputError("订单筛选长度超限。"); filters[key] = value; }
  }
  const dateField = params.get("dateField") === "createdTime" ? "createdTime" : "sourceUpdatedAt";
  const dates: { gte?: Date; lt?: Date } = {};
  for (const key of ["from", "to"] as const) {
    const value = params.get(key); if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new SyncInputError("订单日期格式无效。");
    if (key === "from") dates.gte = new Date(value); else dates.lt = new Date(Date.parse(value) + 86400000);
  }
  if (dates.gte && dates.lt && dates.gte >= dates.lt) throw new SyncInputError("订单日期范围无效。");
  if (Object.keys(dates).length) filters[dateField] = dates;
  const sellerSku = params.get("sellerSku"), asin = params.get("asin");
  if (sellerSku || asin || params.get("itemsOnly") === "true") {
    if ((sellerSku?.length ?? 0) > 500 || (asin?.length ?? 0) > 500) throw new SyncInputError("订单商品筛选长度超限。");
    filters.items = { some: { ...(sellerSku ? { sellerSku } : {}), ...(asin ? { asin } : {}) } };
  }
  return { AND: [scope, sellerAccessWhere(access), filters, { source: { resource: "orders" } }] };
}

/** Current non-PII facts are page committed, not immutable run snapshots.
 * Cursor completeness is returned separately. Raw envelopes/tokens never leave this query.
 */
export async function readOrders(scope: SyncScope, params: URLSearchParams, actor?: string) {
  const access = await amazonDataAccess(scope, actor);
  const where = orderReadWhere(scope, params, access);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
  return prisma.$transaction(async tx => {
    const [total, rows, sources] = await Promise.all([
      tx.amazonOrderRecord.count({ where }),
      tx.amazonOrderRecord.findMany({ where, orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
        select: { amazonOrderId: true, sourceId: true, sourceRunId: true, sellerAccountId: true, marketplaceId: true, createdTime: true, sourceUpdatedAt: true, rawStatus: true, normalizedStatus: true, marketplaceTimeZone: true, capturedAt: true, detailsUpdatedAt: true, detailPolicyDigest: true, grandTotalOriginal: true, currencyCode: true, items: { select: { orderItemId: true, asin: true, sellerSku: true, quantityOrdered: true, proceedsOriginal: true, currencyCode: true } } } }),
      tx.amazonSyncDataSource.findMany({ where: { AND: [{ ...scope, resource: "orders", ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}), ...(params.get("sourceId") ? { id: params.get("sourceId")! } : {}) }, sellerAccessWhere(access)] },
        select: { id: true, enabled: true, marketplaceId: true, orderPolicy: true, seller: { select: { displayName: true } }, resourceCursor: { select: { watermarkFrom: true, watermarkTo: true, lastSuccessAt: true, status: true, listComplete: true, detailPolicyDigest: true, updatedAt: true } } }, take: 201 }),
    ]);
    if (sources.length > 200) throw new SyncInputError("订单数据源超过试点容量。", 409);
    const sourceViews = sources.map(({ orderPolicy, resourceCursor, ...source }) => {
      const details = (orderPolicy as Prisma.JsonObject | null)?.details;
      const safeCursor = resourceCursor ? { watermarkFrom: resourceCursor.watermarkFrom, watermarkTo: resourceCursor.watermarkTo, lastSuccessAt: resourceCursor.lastSuccessAt, status: resourceCursor.status, listComplete: resourceCursor.listComplete, updatedAt: resourceCursor.updatedAt } : null;
      return { ...source, resourceCursor: safeCursor, detailsEnabled: !!details, detailsComplete: !!details && resourceCursor?.status === "SUCCEEDED" && resourceCursor.detailPolicyDigest === digest(details) };
    });
    const detailDigests = new Map(sources.map(s => { const details = (s.orderPolicy as Prisma.JsonObject | null)?.details; return [s.id, details ? digest(details) : null]; }));
    return { rows: rows.map(({ detailPolicyDigest, ...row }) => ({ ...row, detailsCurrent: !!row.detailsUpdatedAt && row.detailsUpdatedAt >= row.sourceUpdatedAt && !!detailPolicyDigest && detailPolicyDigest === detailDigests.get(row.sourceId) })), sources: sourceViews, pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) }, completeness: "PAGE_COMMITTED", detailsComplete: sourceViews.length > 0 && sourceViews.every(s => s.detailsComplete) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
