import { parseAmazonBusinessJson } from "./business-data";
import { amazonAccountReadAccess } from "./read-account";
import { type AmazonDataAccess } from "./data-access";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { businessDate } from "./date-range";
import { SyncInputError, type SyncScope } from "./policy";

export type SalesQuery = { from?: string; to?: string; sellerAccountId?: string; marketplaceId?: string; taskId?: string; keyword?: string; direction: "asc" | "desc" };
export function parseSalesQuery(p: URLSearchParams): SalesQuery {
  for (const key of ["sku", "asin", "orderId"]) if (p.get(key)) throw new SyncInputError("当前报告为店铺逐日汇总，不支持 SKU / ASIN / Order ID 筛选。");
  const from = p.get("from") ? businessDate(p.get("from")) : undefined, to = p.get("to") ? businessDate(p.get("to")) : undefined;
  if (from && to && from > to) throw new SyncInputError("业务日期范围倒置。");
  if (p.get("sort") && p.get("sort") !== "businessDate") throw new SyncInputError("仅支持业务日期排序。");
  if (p.get("quality") && p.get("quality") !== "VALID") throw new SyncInputError("正式查询仅返回完整有效版本；异常请查看任务质量记录。");
  if (p.get("status") && p.get("status") !== "SUCCEEDED") throw new SyncInputError("正式查询仅返回成功发布的数据。");
  if (p.get("direction") && !["asc", "desc"].includes(p.get("direction")!)) throw new SyncInputError("排序方向无效。");
  const text = (key: string) => { const v = p.get(key)?.trim(); if (v && v.length > 200) throw new SyncInputError("筛选条件过长。"); return v || undefined; };
  return { from, to, sellerAccountId: text("sellerAccountId"), marketplaceId: text("marketplaceId"), taskId: text("taskId"), keyword: text("keyword"), direction: p.get("direction") === "asc" ? "asc" : "desc" };
}
/** Every business day resolves independently, so a new small window cannot hide older dates. */
export function salesVersionSql(scope: SyncScope, query: SalesQuery, cutoff: Date, access?: AmazonDataAccess, sourceFence?: string[]) {
  return Prisma.sql`WITH versions AS (
    SELECT DISTINCT ON (r."sourceId", r."businessDate") r.*, t."finishedAt" AS "publishedAt", t."frozenScope", t.summary,
      s."authorizationId", a."amazonSellerId", seller."displayName" AS "sellerName"
    FROM "AmazonSalesTrafficSnapshot" r
    JOIN "AmazonSyncRun" t ON t.id = r."syncRunId" AND t."organizationId" = r."organizationId" AND t."workspaceId" = r."workspaceId" AND t."sourceId" = r."sourceId"
    LEFT JOIN "AmazonSyncRawPage" raw ON raw."taskId" = t.id AND raw."page" = 1 AND raw.resource = 'sales_traffic'
      AND raw."organizationId" = r."organizationId" AND raw."workspaceId" = r."workspaceId"
    JOIN "AmazonSyncDataSource" s ON s.id = r."sourceId" AND s."organizationId" = r."organizationId" AND s."workspaceId" = r."workspaceId"
    JOIN "AmazonSpApiAuthorization" a ON a.id = s."authorizationId" AND a."organizationId" = r."organizationId" AND a."workspaceId" = r."workspaceId"
    JOIN "SellerAccount" seller ON seller.id = r."sellerAccountId" AND seller."organizationId" = r."organizationId" AND seller."workspaceId" = r."workspaceId"
    WHERE r."organizationId" = ${scope.organizationId} AND r."workspaceId" = ${scope.workspaceId}
      AND r."sellerAccountId" = s."sellerAccountId" AND r."marketplaceId" = s."marketplaceId"
      ${access && !access.allSellers ? (access.sellerIds.length ? Prisma.sql`AND r."sellerAccountId" IN (${Prisma.join(access.sellerIds)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ${access?.scopes ? access.scopes.length ? Prisma.sql`AND (${Prisma.join(access.scopes.map(s => Prisma.sql`(r."sellerAccountId" = ${s.sellerAccountId} ${s.marketplaceIds.length ? Prisma.sql`AND r."marketplaceId" IN (${Prisma.join(s.marketplaceIds)})` : Prisma.empty})`), " OR ")})` : Prisma.sql`AND FALSE` : Prisma.empty}
      ${sourceFence !== undefined ? sourceFence.length ? Prisma.sql`AND r."sourceId" IN (${Prisma.join(sourceFence)})` : Prisma.sql`AND FALSE` : Prisma.empty}
      AND s.resource = 'sales_traffic' AND t.status = 'SUCCEEDED' AND t."executionVersion" = 2 AND t.resource = 'sales_traffic' AND t.stage <> 'PURGED' AND r.quality = 'VALID' AND t."finishedAt" <= ${cutoff}
      ${query.from ? Prisma.sql`AND r."businessDate" >= ${query.from}` : Prisma.empty}
      ${query.to ? Prisma.sql`AND r."businessDate" <= ${query.to}` : Prisma.empty}
      ${query.sellerAccountId ? Prisma.sql`AND r."sellerAccountId" = ${query.sellerAccountId}` : Prisma.empty}
      ${query.marketplaceId ? Prisma.sql`AND r."marketplaceId" = ${query.marketplaceId}` : Prisma.empty}
      ${query.taskId ? Prisma.sql`AND r."syncRunId" = ${query.taskId}` : Prisma.empty}
    ORDER BY r."sourceId", r."businessDate", COALESCE(raw."capturedAt", r."capturedAt") DESC, t."startedAt" DESC, t."finishedAt" DESC, t.id DESC
  ), filtered AS (
    SELECT * FROM versions
    ${query.keyword ? Prisma.sql`WHERE position(lower(${query.keyword}) in lower("sellerName" || ' ' || "amazonSellerId" || ' ' || "marketplaceId")) > 0` : Prisma.empty}
  )`;
}
export type SalesMetrics = Prisma.JsonObject & {
  unitsOrdered?: string | null; totalOrderItems?: string | null; sessions?: string | null; pageViews?: string | null;
  orderedProductSales?: { amount?: string | null; currencyCode?: string | null } | null;
};
export type SalesRow = { id: string; organizationId: string; workspaceId: string; sourceId: string; syncRunId: string; sellerAccountId: string; marketplaceId: string; businessDate: string; reportId: string; documentId: string; metrics: SalesMetrics; quality: string; capturedAt: Date; publishedAt: Date; amazonSellerId: string; sellerName: string; frozenScope: unknown; summary: unknown };

/** 店铺×业务日矩阵单元格。数值保持原始 JSON 字符串；缺失为 null，绝不补零。 */
export type SalesMatrixCell = {
  unitsOrdered: string | null; totalOrderItems: string | null;
  orderedProductSales: { amount: string; currencyCode: string } | null;
  sessions: string | null; pageViews: string | null;
  quality: string; syncRunId: string; capturedAt: string;
};
export type SalesMatrixDimension = { key: string; sellerAccountId: string; marketplaceId: string; sellerName: string; sourceId: string };
export type SalesMatrix = {
  granularity: "SELLER_DAY";
  dimensions: SalesMatrixDimension[];
  dates: string[];
  cells: Record<string, Record<string, SalesMatrixCell>>;
  coverage: { days: number; storeDays: number; coveredStoreDays: number };
  rowCount: number; truncated: boolean; asOf: string;
};
export const SALES_MATRIX_MAX_ROWS = 5000;
export const dimensionKey = (row: Pick<SalesRow, "sellerAccountId" | "marketplaceId" | "sourceId">) => `${row.sellerAccountId}|${row.marketplaceId}|${row.sourceId}`;
/**
 * 纯函数：把已发布的店铺×业务日行透视成矩阵。只用真实行，缺日为 null（不补 0）。
 * granularity 固定 SELLER_DAY；不接收 ASIN/SKU 行，因此不会伪造商品日事实。
 */
export function pivotSalesMatrix(rows: SalesRow[], asOf: string, rowLimit = SALES_MATRIX_MAX_ROWS): SalesMatrix {
  const dimensions = new Map<string, SalesMatrixDimension>();
  const dates = new Set<string>();
  const cells: Record<string, Record<string, SalesMatrixCell>> = {};
  let rowCount = 0, truncated = false;
  for (const row of rows) {
    if (rowCount >= rowLimit) { truncated = true; break; }
    rowCount++;
    const key = dimensionKey(row);
    if (!dimensions.has(key)) dimensions.set(key, { key, sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, sellerName: row.sellerName, sourceId: row.sourceId });
    dates.add(row.businessDate);
    const m = row.metrics ?? {};
    const sale = m.orderedProductSales;
    const cell: SalesMatrixCell = {
      unitsOrdered: typeof m.unitsOrdered === "string" ? m.unitsOrdered : null,
      totalOrderItems: typeof m.totalOrderItems === "string" ? m.totalOrderItems : null,
      orderedProductSales: sale && typeof sale.amount === "string" && typeof sale.currencyCode === "string" ? { amount: sale.amount, currencyCode: sale.currencyCode } : null,
      sessions: typeof m.sessions === "string" ? m.sessions : null,
      pageViews: typeof m.pageViews === "string" ? m.pageViews : null,
      quality: row.quality, syncRunId: row.syncRunId, capturedAt: String(row.capturedAt),
    };
    if (!cells[key]) cells[key] = {};
    cells[key][row.businessDate] = cell;
  }
  const dims = [...dimensions.values()].sort((a, b) => a.key.localeCompare(b.key));
  const dateList = [...dates].sort();
  let coveredStoreDays = 0;
  for (const dim of dims) coveredStoreDays += Object.keys(cells[dim.key] ?? {}).length;
  return {
    granularity: "SELLER_DAY", dimensions: dims, dates: dateList, cells,
    coverage: { days: dateList.length, storeDays: dims.length * dateList.length, coveredStoreDays },
    rowCount, truncated, asOf,
  };
}
/** 有界读取全部已发布店铺日行并透视；权限、版本 cutoff、口径均复用 readSalesTraffic。 */
export async function readSalesMatrix(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}) {
  const all: SalesRow[] = [];
  const pageSize = 1000;
  for (let page = 1; page <= Math.ceil(SALES_MATRIX_MAX_ROWS / pageSize); page++) {
    const pageParams = new URLSearchParams(p);
    pageParams.set("page", String(page));
    const result = await readSalesTraffic(scope, pageParams, { ...options, pageSize, action: "view" });
    all.push(...result.rows);
    if (all.length >= SALES_MATRIX_MAX_ROWS || page >= result.pagination.pageCount) break;
  }
  return pivotSalesMatrix(all, (options.cutoff ?? new Date()).toISOString());
}
export async function readSalesTraffic(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; pageSize?: number; actor?: string; sellerFence?: string[]; sourceFence?: string[]; action?: "view" | "export" } = {}) {
  p = new URLSearchParams(p);
  let access = await amazonAccountReadAccess(scope, options.actor, p, prisma, "sales_traffic");
  p.set("sellerAccountId", access.sellerIds[0]);
  if (options.sellerFence) access = { allSellers: false, sellerIds: access.allSellers ? options.sellerFence : options.sellerFence.filter(id => access.sellerIds.includes(id)), ...(access.scopes ? { scopes: access.scopes.filter(s => options.sellerFence!.includes(s.sellerAccountId)) } : {}) };
  const query = parseSalesQuery(p), cutoff = options.cutoff ?? new Date(), cte = salesVersionSql(scope, query, cutoff, access, options.sourceFence);
  const page = Math.min(10000, Math.max(1, Math.floor(Number(p.get("page")) || 1))), pageSize = options.pageSize ?? 50;
  const result = await prisma.$transaction(async tx => {
    const total = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`${cte} SELECT count(*) FROM filtered`);
    const rows = await tx.$queryRaw<Array<Omit<SalesRow, "metrics"> & { metricsText: string }>>(Prisma.sql`${cte} SELECT filtered.*, metrics::text AS "metricsText" FROM filtered ORDER BY "businessDate" ${query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, "sourceId", id OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`);
    return { rows, pagination: { page, pageSize, total: Number(total[0].count), pageCount: Math.ceil(Number(total[0].count) / pageSize) }, query, asOf: cutoff.toISOString(), dateField: "report_business_date", granularity: "SELLER_DAY", versionPolicy: query.taskId ? "historical_task" : "latest_successful_per_source_day" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, options.actor, p, prisma, "sales_traffic");
  return { ...result, numericEncoding: "JSON_NUMERIC_STRINGS", rows: result.rows.map(({ metricsText, ...row }) => {
    const metrics = parseAmazonBusinessJson(metricsText);
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new SyncInputError("销售指标不是有效的 JSON 对象。", 409);
    return { ...row, metrics: metrics as SalesMetrics };
  }) };
}

/** 商品日查询参数：在店铺日基础上放开商品身份筛选。 */
export type ProductSalesQuery = SalesQuery & { asin?: string; parentAsin?: string; sellerSku?: string; granularity?: "CHILD" | "SKU" };
export function parseProductSalesQuery(p: URLSearchParams): ProductSalesQuery {
  const baseParams = new URLSearchParams();
  for (const key of ["from", "to", "sellerAccountId", "marketplaceId", "taskId", "keyword", "sort", "quality", "status", "direction", "page", "pageSize"]) {
    for (const value of p.getAll(key)) baseParams.append(key, value);
  }
  const base = parseSalesQuery(baseParams);
  const text = (key: string) => { const v = p.get(key)?.trim(); if (v && v.length > 100) throw new SyncInputError("商品筛选条件过长。"); return v || undefined; };
  const asin = text("asin"), parentAsin = text("parentAsin"), sellerSku = text("sellerSku");
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) throw new SyncInputError("ASIN 格式无效。");
  if (parentAsin && !/^[A-Z0-9]{10}$/.test(parentAsin)) throw new SyncInputError("父 ASIN 格式无效。");
  const granularity = p.get("granularity");
  if (granularity && granularity !== "CHILD" && granularity !== "SKU") throw new SyncInputError("商品日粒度无效。");
  return { ...base, asin, parentAsin, sellerSku, granularity: granularity as "CHILD" | "SKU" | undefined };
}
export type ProductSalesRow = {
  id: string; organizationId: string; workspaceId: string; sourceId: string; syncRunId: string;
  sellerAccountId: string; marketplaceId: string; businessDate: string; granularity: string;
  childAsin: string; parentAsin: string | null; sellerSku: string | null; reportId: string; documentId: string;
  metrics: SalesMetrics; quality: string; capturedAt: Date; sellerName: string; amazonSellerId: string; publishedAt: Date;
};
/** 商品日版本 SQL：每 (sourceId, businessDate, granularity, 身份) 取最新成功完整版本；权限与店铺日完全一致。 */
function productVersionSql(scope: SyncScope, query: ProductSalesQuery, cutoff: Date, access?: AmazonDataAccess, sourceFence?: string[]) {
  return Prisma.sql`WITH versions AS (
    SELECT DISTINCT ON (r."sourceId", r."businessDate", r."granularity", r."childAsin", COALESCE(r."sellerSku", '')) r.*, t."finishedAt" AS "publishedAt",
      a."amazonSellerId", seller."displayName" AS "sellerName"
    FROM "AmazonSalesTrafficProductSnapshot" r
    JOIN "AmazonSyncRun" t ON t.id = r."syncRunId" AND t."organizationId" = r."organizationId" AND t."workspaceId" = r."workspaceId" AND t."sourceId" = r."sourceId"
    JOIN "AmazonSyncDataSource" s ON s.id = r."sourceId" AND s."organizationId" = r."organizationId" AND s."workspaceId" = r."workspaceId"
    JOIN "AmazonSpApiAuthorization" a ON a.id = s."authorizationId" AND a."organizationId" = r."organizationId" AND a."workspaceId" = r."workspaceId"
    JOIN "SellerAccount" seller ON seller.id = r."sellerAccountId" AND seller."organizationId" = r."organizationId" AND seller."workspaceId" = r."workspaceId"
    WHERE r."organizationId" = ${scope.organizationId} AND r."workspaceId" = ${scope.workspaceId}
      AND r."sellerAccountId" = s."sellerAccountId" AND r."marketplaceId" = s."marketplaceId"
      ${access && !access.allSellers ? (access.sellerIds.length ? Prisma.sql`AND r."sellerAccountId" IN (${Prisma.join(access.sellerIds)})` : Prisma.sql`AND FALSE`) : Prisma.empty}
      ${access?.scopes ? access.scopes.length ? Prisma.sql`AND (${Prisma.join(access.scopes.map(s => Prisma.sql`(r."sellerAccountId" = ${s.sellerAccountId} ${s.marketplaceIds.length ? Prisma.sql`AND r."marketplaceId" IN (${Prisma.join(s.marketplaceIds)})` : Prisma.empty})`), " OR ")})` : Prisma.sql`AND FALSE` : Prisma.empty}
      ${sourceFence !== undefined ? sourceFence.length ? Prisma.sql`AND r."sourceId" IN (${Prisma.join(sourceFence)})` : Prisma.sql`AND FALSE` : Prisma.empty}
      AND s.resource = 'sales_traffic' AND t.status = 'SUCCEEDED' AND t."executionVersion" = 2 AND t.resource = 'sales_traffic' AND t.stage <> 'PURGED' AND r.quality = 'VALID' AND t."finishedAt" <= ${cutoff}
      ${query.from ? Prisma.sql`AND r."businessDate" >= ${query.from}` : Prisma.empty}
      ${query.to ? Prisma.sql`AND r."businessDate" <= ${query.to}` : Prisma.empty}
      ${query.sellerAccountId ? Prisma.sql`AND r."sellerAccountId" = ${query.sellerAccountId}` : Prisma.empty}
      ${query.marketplaceId ? Prisma.sql`AND r."marketplaceId" = ${query.marketplaceId}` : Prisma.empty}
      ${query.taskId ? Prisma.sql`AND r."syncRunId" = ${query.taskId}` : Prisma.empty}
      ${query.asin ? Prisma.sql`AND r."childAsin" = ${query.asin}` : Prisma.empty}
      ${query.parentAsin ? Prisma.sql`AND r."parentAsin" = ${query.parentAsin}` : Prisma.empty}
      ${query.sellerSku ? Prisma.sql`AND r."sellerSku" = ${query.sellerSku}` : Prisma.empty}
      ${query.granularity ? Prisma.sql`AND r."granularity" = ${query.granularity}` : Prisma.empty}
    ORDER BY r."sourceId", r."businessDate", r."granularity", r."childAsin", COALESCE(r."sellerSku", ''), t."finishedAt" DESC, t."startedAt" DESC, t.id DESC
  ), filtered AS (
    SELECT * FROM versions
    ${query.keyword ? Prisma.sql`WHERE position(lower(${query.keyword}) in lower("childAsin" || ' ' || COALESCE("parentAsin", '') || ' ' || COALESCE("sellerSku", ''))) > 0` : Prisma.empty}
  )`;
}
const PRODUCT_MAX_PAGE_SIZE = 1000;
/** 商品日查询：权限、版本 cutoff、口径与 readSalesTraffic 完全一致，仅作用于商品事实表。 */
export async function readSalesProducts(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}) {
  p = new URLSearchParams(p);
  const access = await amazonAccountReadAccess(scope, options.actor, p, prisma, "sales_traffic");
  p.set("sellerAccountId", access.sellerIds[0]);
  const query = parseProductSalesQuery(p), cutoff = options.cutoff ?? new Date(), cte = productVersionSql(scope, query, cutoff, access);
  const page = Math.min(10000, Math.max(1, Math.floor(Number(p.get("page")) || 1))), pageSize = Math.min(PRODUCT_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(p.get("pageSize")) || 100)));
  const result = await prisma.$transaction(async tx => {
    const total = await tx.$queryRaw<Array<{ count: bigint }>>`${cte} SELECT count(*) FROM filtered`;
    const rows = await tx.$queryRaw<Array<Omit<ProductSalesRow, "metrics"> & { metricsText: string }>>`${cte} SELECT filtered.*, metrics::text AS "metricsText" FROM filtered ORDER BY "businessDate" ${query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, "childAsin", "sourceId" OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`;
    return { rows, pagination: { page, pageSize, total: Number(total[0].count), pageCount: Math.ceil(Number(total[0].count) / pageSize) }, query, asOf: cutoff.toISOString(), granularity: query.granularity ?? "ALL", versionPolicy: "latest_successful_per_source_day_identity" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await amazonAccountReadAccess(scope, options.actor, p, prisma, "sales_traffic");
  return { ...result, numericEncoding: "JSON_NUMERIC_STRINGS", rows: result.rows.map(({ metricsText, ...row }) => {
    const metrics = parseAmazonBusinessJson(metricsText);
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new SyncInputError("商品销售指标不是有效的 JSON 对象。", 409);
    return { ...row, metrics: metrics as SalesMetrics };
  }) };
}
