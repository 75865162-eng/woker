import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonScopeAdmin, assertAmazonAction } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

/** P3 seller-wide finance is visible only to live scope admins. Site grants and
 * MCP credentials cannot expose cross-site raw archives or quarantine contents.
 * Explicit projection excludes all encrypted evidence, buyer data and cursors.
 */
export async function readFinance(scope: SyncScope, params: URLSearchParams, actor?: string) {
  if (!actor) throw new SyncInputError("缺少财务查询操作人。", 403);
  return prisma.$transaction(async tx => {
    await assertAmazonScopeAdmin(scope, actor, tx); await assertAmazonAction(scope, actor, "view", tx);
    const filters: Prisma.AmazonFinanceRecordWhereInput = {};
    for (const key of ["sourceId", "sellerAccountId", "marketplaceId", "currency", "orderId", "classification", "rawStatus"] as const) {
      const v = params.get(key); if (v) { if (v.length > 200) throw new SyncInputError("财务筛选长度超限。"); filters[key] = v; }
    }
    const postedAt: { gte?: Date; lt?: Date } = {};
    for (const key of ["from", "to"] as const) {
      const v = params.get(key); if (!v) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new SyncInputError("财务日期格式无效。");
      if (key === "from") postedAt.gte = new Date(v); else postedAt.lt = new Date(Date.parse(v) + 86400000);
    }
    if (postedAt.gte && postedAt.lt && postedAt.gte >= postedAt.lt) throw new SyncInputError("财务日期范围无效。");
    if (Object.keys(postedAt).length) filters.postedAt = postedAt;
    const base = { ...scope, source: { resource: "finance" }, ...filters };
    const where = { ...base, attributionStatus: "ATTRIBUTED" };
    const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
    const [total, rows, quarantinedCount, unconvertedCount, sources] = await Promise.all([
      tx.amazonFinanceRecord.count({ where }),
      tx.amazonFinanceRecord.findMany({ where, orderBy: [{ postedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { transactionId: true, sourceId: true, sellerAccountId: true, marketplaceId: true, marketplaceTimeZone: true, postedAt: true, transactionType: true, rawStatus: true, orderId: true, classification: true, originalAmount: true, currency: true, convertedAmount: true, convertedCurrency: true, conversionStatus: true, capturedAt: true } }),
      // Quarantine has no site/currency/order attribution, so report the scoped
      // source/seller total explicitly rather than imply a filtered site total.
      tx.amazonFinanceRecord.count({ where: { ...scope, source: { resource: "finance" }, ...(filters.sourceId ? { sourceId: filters.sourceId } : {}), ...(filters.sellerAccountId ? { sellerAccountId: filters.sellerAccountId } : {}), attributionStatus: "QUARANTINED" } }),
      tx.amazonFinanceRecord.count({ where: { ...where, conversionStatus: "UNCONVERTED" } }),
      tx.amazonSyncDataSource.findMany({ where: { ...scope, resource: "finance", ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("sourceId") ? { id: params.get("sourceId")! } : {}) }, take: 201, select: { id: true, enabled: true, seller: { select: { displayName: true } }, resourceCursor: { select: { watermarkFrom: true, watermarkTo: true, status: true, lastSuccessAt: true } } } }),
    ]);
    if (sources.length > 200) throw new SyncInputError("财务数据源超过试点容量。", 409);
    return { rows: rows.map(r => ({ ...r, convertedAmount: r.convertedAmount?.toString() ?? null })), sources, pagination: { total, page, pageSize, pageCount: Math.ceil(total / pageSize) }, quarantinedCount, unconvertedCount, financialFinal: false, completeness: "PAGE_COMMITTED" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
