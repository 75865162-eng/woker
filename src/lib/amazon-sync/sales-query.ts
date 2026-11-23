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
  productTitle?: string | null; imageUrl?: string | null;
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
  const rows = result.rows.map(({ metricsText, ...row }) => {
    const metrics = parseAmazonBusinessJson(metricsText);
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new SyncInputError("商品销售指标不是有效的 JSON 对象。", 409);
    return { ...row, metrics: metrics as SalesMetrics };
  });
  return { ...result, numericEncoding: "JSON_NUMERIC_STRINGS", rows: await attachProductDisplay(scope, rows) };
}

/** 给商品日行补标题/图片：批量关联目录快照与图片引用；缺失留空，不猜不补。 */
export async function attachProductDisplay(scope: SyncScope, rows: ProductSalesRow[]): Promise<ProductSalesRow[]> {
  const asins = [...new Set(rows.map(r => r.childAsin).filter(asin => /^[A-Z0-9]{10}$/.test(asin)))];
  if (!asins.length) return rows.map(row => ({ ...row, productTitle: null, imageUrl: null }));
  const [catalog, images] = await Promise.all([
    prisma.amazonCatalogSnapshot.findMany({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, asin: { in: asins } }, orderBy: { capturedAt: "desc" }, select: { asin: true, sellerAccountId: true, marketplaceId: true, listingAttributes: true } }),
    prisma.amazonCatalogImageReference.findMany({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, asin: { in: asins }, variant: "MAIN" }, select: { asin: true, sellerAccountId: true, marketplaceId: true, sourceUrl: true } }),
  ]);
  const titleByAsin = new Map<string, string>();
  for (const item of catalog) {
    if (titleByAsin.has(item.asin)) continue;
    const attributes = item.listingAttributes as { itemName?: unknown } | null;
    const name = attributes && typeof attributes.itemName === "string" ? attributes.itemName.trim().slice(0, 300) : "";
    if (name) titleByAsin.set(item.asin, name);
  }
  const imageByAsin = new Map<string, string>();
  for (const image of images) if (!imageByAsin.has(image.asin) && image.sourceUrl) imageByAsin.set(image.asin, image.sourceUrl);
  return rows.map(row => ({ ...row, productTitle: titleByAsin.get(row.childAsin) ?? null, imageUrl: imageByAsin.get(row.childAsin) ?? null }));
}

/* ===== 周期汇总（日/周/月 rollup + 区间合计 + 等长环比）：仅聚合已发布真实行，缺日不补零 ===== */
export type SalesPeriodBucket = "day" | "week" | "month";
export type SalesAmount = { currency: string; amount: string };
export type SalesPeriodAgg = {
  period: string; periodStart: string; periodEnd: string;
  stores: number; coveredStoreDays: number; totalStoreDays: number;
  unitsOrdered: string | null; totalOrderItems: string | null;
  sessions: string | null; pageViews: string | null;
  sales: SalesAmount[];
};
export type SalesPeriodSummary = {
  bucket: SalesPeriodBucket;
  periods: SalesPeriodAgg[];
  totals: SalesPeriodAgg & { complete: boolean };
  previous: (SalesPeriodAgg & { complete: boolean }) | null;
  truncated: boolean; asOf: string;
};
const PERIOD_MAX_ROWS = 20000;
export const num = (v: unknown): number | null => { const s = typeof v === "string" ? v.trim() : ""; if (!s || !/^\d+(\.\d+)?$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
export function isoWeekOf(dateStr: string): { year: number; week: number; monday: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  const monday = new Date(date.getTime() - 3 * 86_400_000);
  return { year: date.getUTCFullYear(), week, monday: monday.toISOString().slice(0, 10) };
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export function shiftDays(dateStr: string, delta: number): string { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); }
export function aggregateRows(rows: SalesRow[], periodOf: (date: string) => { key: string; start: string; end: string }, totalDaysOf: (start: string, end: string) => number): SalesPeriodAgg[] {  const groups = new Map<string, { start: string; end: string; stores: Set<string>; storeDays: number; units: number | null; items: number | null; sessions: number | null; views: number | null; sales: Map<string, number> }>();
  for (const row of rows) {
    const { key, start, end } = periodOf(row.businessDate);
    let g = groups.get(key);
    if (!g) { g = { start, end, stores: new Set(), storeDays: 0, units: 0, items: 0, sessions: 0, views: 0, sales: new Map() }; groups.set(key, g); }
    g.stores.add(row.sellerAccountId); g.storeDays++;
    const m = row.metrics ?? {};
    const u = num(m.unitsOrdered), i = num(m.totalOrderItems), s = num(m.sessions), v = num(m.pageViews);
    if (u !== null) g.units = (g.units ?? 0) + u; else g.units = null;
    if (i !== null) g.items = (g.items ?? 0) + i; else g.items = null;
    if (s !== null) g.sessions = (g.sessions ?? 0) + s; else g.sessions = null;
    if (v !== null) g.views = (g.views ?? 0) + v; else g.views = null;
    const sale = m.orderedProductSales;
    if (sale && typeof sale.amount === "string" && typeof sale.currencyCode === "string" && sale.currencyCode) {
      const a = num(sale.amount); if (a !== null) g.sales.set(sale.currencyCode, (g.sales.get(sale.currencyCode) ?? 0) + a);
    }
  }
  const fmt = (n: number | null, digits = 0) => n === null ? null : digits ? n.toFixed(digits) : String(Math.round(n));
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, g]) => ({
    period: key, periodStart: g.start, periodEnd: g.end,
    stores: g.stores.size, coveredStoreDays: g.storeDays, totalStoreDays: g.stores.size * totalDaysOf(g.start, g.end),
    unitsOrdered: fmt(g.units), totalOrderItems: fmt(g.items), sessions: fmt(g.sessions), pageViews: fmt(g.views),
    sales: [...g.sales.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
  }));
}
export function summarize(rows: SalesRow[]): SalesPeriodSummary["totals"] {
  const [agg] = aggregateRows(rows, (d) => ({ key: "all", start: d, end: d }), () => 1);
  const covered = agg?.coveredStoreDays ?? 0;
  const dates = new Set(rows.map(r => r.businessDate));
  const stores = new Set(rows.map(r => r.sellerAccountId));
  const total = dates.size * stores.size;
  return { ...(agg ?? { period: "all", periodStart: "", periodEnd: "", stores: 0, coveredStoreDays: 0, totalStoreDays: 0, unitsOrdered: null, totalOrderItems: null, sessions: null, pageViews: null, sales: [] as SalesAmount[] }), coveredStoreDays: covered, totalStoreDays: total, complete: rows.length > 0 && covered === total };
}
/** 周期汇总读取：先读全量已发布店铺日行（复用 readSalesTraffic 权限与版本口径），再应用层 rollup；环比仅在两期数据完整时计算。 */
export async function readSalesPeriods(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}): Promise<SalesPeriodSummary> {
  p = new URLSearchParams(p);
  const bucketParam = p.get("bucket");
  if (bucketParam && !["day", "week", "month"].includes(bucketParam)) throw new SyncInputError("聚合粒度无效。");
  const bucket: SalesPeriodBucket = bucketParam === "week" ? "week" : bucketParam === "month" ? "month" : "day";
  const rows = await readSalesRowsForAggregation(scope, p, options);
  const periodOf = bucket === "week"
    ? (d: string) => { const w = isoWeekOf(d); return { key: `${w.year}-W${String(w.week).padStart(2, "0")}`, start: w.monday, end: shiftDays(w.monday, 6) }; }
    : bucket === "month"
      ? (d: string) => { const key = d.slice(0, 7); const [y, m] = key.split("-").map(Number); return { key, start: d.slice(0, 8) + "01", end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; }
      : (d: string) => ({ key: d, start: d, end: d });
  const periods = aggregateRows(rows, periodOf, (s, e) => daysBetween(s, e));
  const totals = summarize(rows);
  let previous: SalesPeriodSummary["previous"] = null;
  if (!p.get("taskId") && rows.length > 0) {
    const dates = [...new Set(rows.map(r => r.businessDate))].sort();
    const from = p.get("from") ?? dates[0], to = p.get("to") ?? dates[dates.length - 1];
    const span = daysBetween(from, to);
    const prevP = new URLSearchParams(p);
    prevP.set("from", shiftDays(from, -span)); prevP.set("to", shiftDays(from, -1));
    const prevRows = await readSalesRowsForAggregation(scope, prevP, options);
    if (prevRows.length > 0) {
      const prevTotals = summarize(prevRows);
      if (prevTotals.complete && totals.complete) previous = prevTotals;
    }
  }
  return { bucket, periods, totals, previous, truncated: rows.length >= PERIOD_MAX_ROWS, asOf: (options.cutoff ?? new Date()).toISOString() };
}
/** 有界拉取全部已发布店铺日行（复用 readSalesTraffic，权限与版本口径不变）。 */
async function readSalesRowsForAggregation(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}) {
  const all: SalesRow[] = []; const pageSize = 1000;
  for (let page = 1; page <= Math.ceil(PERIOD_MAX_ROWS / pageSize); page++) {
    const pageParams = new URLSearchParams(p);
    pageParams.set("page", String(page));
    const result = await readSalesTraffic(scope, pageParams, { ...options, pageSize, action: "view" });
    all.push(...result.rows);
    if (all.length >= PERIOD_MAX_ROWS || page >= result.pagination.pageCount) break;
  }
  return all;
}

/* ===== 销量排行 TopN（商品日事实聚合；当前区间 vs 等长上期，仅完整数据可比） ===== */
export type SalesTopItem = { identity: string; label: string | null; units: number; sales: SalesAmount[]; stores: number };
export type SalesTopResult = {
  dimension: "child" | "parent" | "sku"; limit: number;
  items: SalesTopItem[]; previous: SalesTopItem[] | null; comparable: boolean;
  coveredStoreDays: number; asOf: string;
};
const TOP_MAX_ROWS = 20000;
/** 排行读取：基于商品日事实（CHILD/SKU 报告）应用层聚合；维度=child|parent|sku。 */
export async function readSalesTop(scope: SyncScope, p: URLSearchParams, options: { cutoff?: Date; actor?: string } = {}): Promise<SalesTopResult> {
  p = new URLSearchParams(p);
  const dimensionParam = p.get("dimension");
  if (dimensionParam && !["child", "parent", "sku"].includes(dimensionParam)) throw new SyncInputError("排行维度无效。");
  const dimension: "child" | "parent" | "sku" = dimensionParam === "parent" ? "parent" : dimensionParam === "sku" ? "sku" : "child";
  const limit = Math.min(50, Math.max(1, Math.floor(Number(p.get("limit")) || 10)));
  const productParams = new URLSearchParams(p);
  productParams.set("granularity", dimension === "sku" ? "SKU" : "CHILD");
  const all: ProductSalesRow[] = []; const pageSize = 1000;
  for (let page = 1; page <= Math.ceil(TOP_MAX_ROWS / pageSize); page++) {
    const pageParams = new URLSearchParams(productParams);
    pageParams.set("page", String(page)); pageParams.set("pageSize", String(pageSize));
    const result = await readSalesProducts(scope, pageParams, options);
    all.push(...result.rows);
    if (all.length >= TOP_MAX_ROWS || page >= result.pagination.pageCount) break;
  }
  const identityOf = (r: ProductSalesRow) => dimension === "sku" ? (r.sellerSku ?? "") : dimension === "parent" ? (r.parentAsin ?? "") : r.childAsin;
  const coveredStoreDays = all.length;
  const items = topFromRows(all, identityOf, limit);
  let previous: SalesTopItem[] | null = null; let comparable = false;
  if (!p.get("taskId") && all.length > 0) {
    const dates = [...new Set(all.map(r => r.businessDate))].sort();
    const stores = new Set(all.map(r => `${r.sellerAccountId}|${r.marketplaceId}`)).size;
    const from = p.get("from") ?? dates[0], to = p.get("to") ?? dates[dates.length - 1];
    const span = daysBetween(from, to);
    const prevP = new URLSearchParams(productParams);
    prevP.set("from", shiftDays(from, -span)); prevP.set("to", shiftDays(from, -1));
    const prevAll: ProductSalesRow[] = [];
    for (let page = 1; page <= Math.ceil(TOP_MAX_ROWS / pageSize); page++) {
      const pageParams = new URLSearchParams(prevP);
      pageParams.set("page", String(page)); pageParams.set("pageSize", String(pageSize));
      const result = await readSalesProducts(scope, pageParams, options);
      prevAll.push(...result.rows);
      if (prevAll.length >= TOP_MAX_ROWS || page >= result.pagination.pageCount) break;
    }
    const expected = stores * span;
    comparable = prevAll.length > 0 && all.length >= expected && prevAll.length >= expected;
    if (comparable) previous = topFromRows(prevAll, identityOf, limit);
  }
  return { dimension, limit, items, previous, comparable, coveredStoreDays, asOf: (options.cutoff ?? new Date()).toISOString() };
}
export function topFromRows(rows: ProductSalesRow[], identityOf: (r: ProductSalesRow) => string, limit: number): SalesTopItem[] {
  const groups = new Map<string, { units: number | null; sales: Map<string, number>; stores: Set<string>; label: string | null }>();
  for (const row of rows) {
    const identity = identityOf(row);
    if (!identity) continue;
    let g = groups.get(identity);
    if (!g) { g = { units: 0, sales: new Map(), stores: new Set(), label: row.sellerName }; groups.set(identity, g); }
    g.stores.add(`${row.sellerAccountId}|${row.marketplaceId}`);
    const u = num(row.metrics?.unitsOrdered);
    if (u !== null) g.units = (g.units ?? 0) + u; else g.units = null;
    const sale = row.metrics?.orderedProductSales;
    if (sale && typeof sale.amount === "string" && typeof sale.currencyCode === "string" && sale.currencyCode) {
      const a = num(sale.amount); if (a !== null) g.sales.set(sale.currencyCode, (g.sales.get(sale.currencyCode) ?? 0) + a);
    }
  }
  return [...groups.entries()]
    .map(([identity, g]) => ({ identity, label: g.label, units: g.units ?? 0, sales: [...g.sales.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })), stores: g.stores.size }))
    .sort((a, b) => b.units - a.units || a.identity.localeCompare(b.identity))
    .slice(0, limit);
}
