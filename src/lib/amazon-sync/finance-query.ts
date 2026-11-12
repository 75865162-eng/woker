import { amazonBusinessData } from "./business-data";
import { queryPageSize } from "./query-page";
import { financeQueryRange } from "./finance-query-range";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellerAccessWhere } from "./data-access";
import { amazonAccountReadAccess } from "./read-account";
import { SyncInputError, type SyncScope } from "./policy";

/** Shared account-scoped finance read; encrypted operational evidence stays server-side. */
export async function readFinance(scope: SyncScope, params: URLSearchParams, actor?: string) {
  params = new URLSearchParams(params);
  if (!actor) throw new SyncInputError("缺少财务查询操作人。", 403);
  const result = await prisma.$transaction(async tx => {
    const access = await amazonAccountReadAccess(scope, actor, params, tx, "finance");
    params.set("sellerAccountId", access.sellerIds[0]);
    const sellerAccountId = access.sellerIds[0];
    const filters: Prisma.AmazonFinanceRecordWhereInput = {};
    for (const key of ["transactionId", "sourceId", "sourceRunId", "sellerAccountId", "marketplaceId", "currency", "orderId", "classification", "rawStatus"] as const) {
      const v = params.get(key); if (v) { if (v.length > 200) throw new SyncInputError("财务筛选长度超限。"); filters[key] = v; }
    }
    const postedAt = financeQueryRange(params);
    if (Object.keys(postedAt).length) filters.postedAt = postedAt;
    const base = { ...scope, ...sellerAccessWhere(access), source: { resource: "finance" }, ...filters };
    const where = { ...base, attributionStatus: "ATTRIBUTED" };
    const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = queryPageSize(params);
    const [total, rows, quarantinedCount, unconvertedCount, sources] = await Promise.all([
      tx.amazonFinanceRecord.count({ where }),
      tx.amazonFinanceRecord.findMany({ where, orderBy: [{ postedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { transactionId: true, sourceId: true, sourceRunId: true, sellerAccountId: true, marketplaceId: true, marketplaceTimeZone: true, postedAt: true, transactionType: true, rawStatus: true, orderId: true, classification: true, originalAmount: true, amount: true, currency: true, fxEvidence: true, attributionStatus: true, observationSequence: true, rowHash: true, convertedAmount: true, convertedCurrency: true, conversionStatus: true, capturedAt: true } }),
      // Quarantine has no site/currency/order attribution, so report the scoped
      // source/seller total explicitly rather than imply a filtered site total.
      tx.amazonFinanceRecord.count({ where: { ...scope, sellerAccountId, source: { resource: "finance" }, ...(filters.sourceId ? { sourceId: filters.sourceId } : {}), ...(filters.sellerAccountId ? { sellerAccountId: filters.sellerAccountId } : {}), attributionStatus: "QUARANTINED" } }),
      tx.amazonFinanceRecord.count({ where: { ...where, conversionStatus: "UNCONVERTED" } }),
      tx.amazonSyncDataSource.findMany({ where: { ...scope, resource: "finance", sellerAccountId, ...(params.get("sourceId") ? { id: params.get("sourceId")! } : {}) }, take: 201, select: { id: true, enabled: true, seller: { select: { displayName: true } }, resourceCursor: { select: { watermarkFrom: true, watermarkTo: true, status: true, lastSuccessAt: true } } } }),
    ]);
    if (sources.length > 200) throw new SyncInputError("财务数据源超过试点容量。", 409);
    return { rows: rows.map(r => ({ ...r, amount: r.amount?.toFixed() ?? null, convertedAmount: r.convertedAmount?.toFixed() ?? null, fxEvidence: amazonBusinessData(r.fxEvidence) })), sources, pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) }, quarantinedCount, unconvertedCount, financialFinal: false, completeness: "PAGE_COMMITTED" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, actor, params, prisma, "finance");
  return result;
}
