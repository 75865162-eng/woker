import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sellerAccessWhere } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

/** Single published report per response. reportId+rowHash cannot deduplicate
 * business events across reports, so never sum overlapping report snapshots.
 * Comments, plaintext/raw documents, signed URLs and checkpoints are excluded.
 */
export async function readReturns(scope: SyncScope, params: URLSearchParams, actor?: string) {
  return prisma.$transaction(async tx => {
    const access = await amazonDataAccess(scope, actor, tx);
    const filters: Prisma.AmazonSyncDataSourceWhereInput = {};
    for (const key of ["sellerAccountId", "marketplaceId"] as const) { const v = params.get(key); if (v) { if (v.length > 200) throw new SyncInputError("退货筛选过长。"); filters[key] = v; } }
    const sources = await tx.amazonSyncDataSource.findMany({ where: { AND: [scope, sellerAccessWhere(access), filters, { resource: "returns" }] }, orderBy: { id: "asc" }, take: 201,
      select: { id: true, authorizationId: true, activeRunId: true, sellerAccountId: true, marketplaceId: true, coverage: true, seller: { select: { displayName: true } }, resourceCursor: { select: { watermarkFrom: true, watermarkTo: true, status: true, lastSuccessAt: true } } } });
    if (sources.length > 200) throw new SyncInputError("退货数据源超过试点容量。", 409);
    const requestedSource = params.get("sourceId");
    const source = requestedSource ? sources.find(s => s.id === requestedSource) : sources[0];
    if (requestedSource && !source) throw new SyncInputError("退货数据源不可访问。", 403);
    const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
    const coverage = source?.coverage as { reportId?: string } | null;
    const reportId = params.get("reportId") || coverage?.reportId;
    let published = false;
    if (source && reportId && reportId.length <= 200) published = !!await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, resource: "returns", status: "SUCCEEDED", summary: { path: ["coverage", "reportId"], equals: reportId } }, select: { id: true } });
    const sourceViews = sources.map(s => ({ id: s.id, marketplaceId: s.marketplaceId, seller: s.seller, resourceCursor: s.resourceCursor, latestReportId: (s.coverage as { reportId?: string } | null)?.reportId ?? null }));
    if (!source || !reportId || !published) return { rows: [], sources: sourceViews, selectedSourceId: source?.id ?? null, reportId: null, pagination: { page, pageSize, total: 0, pageCount: 0 }, completeness: "NO_PUBLISHED_REPORT" };
    const where: Prisma.AmazonReturnRecordWhereInput = { ...scope, sourceId: source.id, reportId };
    for (const [parameter, key] of [["orderId", "amazonOrderId"], ["asin", "asin"], ["rawStatus", "rawStatus"], ["sellerSku", "sellerSku"]] as const) {
      const v = params.get(parameter); if (v) { if (v.length > 500) throw new SyncInputError("退货筛选过长。"); where[key] = v; }
    }
    if (params.get("reason")) where.reason = { code: params.get("reason")!.slice(0, 500) };
    const dates: { gte?: Date; lt?: Date } = {};
    for (const key of ["from", "to"] as const) {
      const v = params.get(key); if (!v) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new SyncInputError("退货筛选日期无效。");
      if (key === "from") dates.gte = new Date(v); else dates.lt = new Date(Date.parse(v) + 86400000);
    }
    if (dates.gte && dates.lt && dates.gte >= dates.lt) throw new SyncInputError("退货日期范围无效。");
    if (Object.keys(dates).length) where.returnAt = dates;
    const [total, rows] = await Promise.all([tx.amazonReturnRecord.count({ where }), tx.amazonReturnRecord.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ returnAt: "desc" }, { id: "asc" }], select: { id: true, amazonOrderId: true, asin: true, sellerSku: true, returnAt: true, quantity: true, disposition: true, rawStatus: true, marketplaceId: true, marketplaceTimeZone: true, reason: { select: { code: true } } } })]);
    const orders = await tx.amazonOrderRecord.findMany({ where: { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonOrderId: { in: rows.map(r => r.amazonOrderId) }, source: { authorizationId: { equals: source.authorizationId } } }, select: { amazonOrderId: true } });
    const ids = new Set(orders.map(o => o.amazonOrderId));
    return { rows: rows.map(r => ({ ...r, orderMatched: ids.has(r.amazonOrderId) })), sources: sourceViews, selectedSourceId: source.id, reportId, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, completeness: "SINGLE_PUBLISHED_REPORT", returnsUniverseComplete: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
