import { sellfoxAgentColumns } from "./agent-read";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SellfoxBrowseError, sellfoxExportLimit, type SellfoxBrowseQuery } from "./browse-query";
import { sellfoxDateAt } from "./sync-contract";
import { resolveEffectiveReportDate } from "./browse-report-date";

type Scope = { organizationId: string; workspaceId: string };
type Row = Record<string, unknown>;
export type WorkbenchDomain = "sales" | "performance" | "listings" | "ads_report";
const sources = { sales: "sellfox_sales_daily", performance: '"SellfoxProductDailySnapshot"', listings: "sellfox_listing_current", ads_report: "sellfox_ads_product_daily" };
function scoped(alias: string, scope: Scope) {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}."organizationId"=${scope.organizationId} AND ${a}."workspaceId"=${scope.workspaceId}`;
}
export function workbenchDateRange(query: SellfoxBrowseQuery) {
  const yesterday = sellfoxDateAt(new Date(), -1);
  const from = query.from || query.reportDate || query.to || yesterday;
  const to = query.to || query.reportDate || query.from || yesterday;
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (query.allDates && !query.from && !query.to) throw new SellfoxBrowseError("日矩阵需选择最多90天的日期范围；全部历史请使用 Agent 窄表导出。", 400);
  if (count > 90) throw new SellfoxBrowseError("日矩阵最多展示90天，请分段选择日期；完整长窗仍可用 Agent 窄表导出。", 400);
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}
// All joins stay in the authenticated workspace. Current metadata is supplemental,
// never historical parent identity, price or inventory at the sale date.
export function workbenchReadSql(domain: WorkbenchDomain, query: SellfoxBrowseQuery, scope: Scope, exporting = false) {
  const filters: Prisma.Sql[] = [scoped("s", scope)];
  if (query.shopExternalIds.length) filters.push(Prisma.sql`st."externalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (query.storeId) filters.push(Prisma.sql`s."storeId"=${query.storeId}`);
  if (query.site) filters.push(Prisma.sql`st.marketplace=${query.site}`);
  if (query.currency) filters.push(Prisma.sql`s.currency=${query.currency}`);
  if (domain !== "listings") {
    if (domain === "sales") {
      const dates = workbenchDateRange(query);
      filters.push(Prisma.sql`s."reportDate">=${dates[0]} AND s."reportDate"<=${dates.at(-1)}`);
    } else {
      if (query.from) filters.push(Prisma.sql`s."reportDate">=${query.from}`);
      if (query.to) filters.push(Prisma.sql`s."reportDate"<=${query.to}`);
      if (!query.from && !query.to && !query.allDates) filters.push(Prisma.sql`s."reportDate"=${query.reportDate || sellfoxDateAt(new Date(), -1)}`);
    }
  } else if (query.status) filters.push(Prisma.sql`s.status ILIKE ${query.status}`);
  if (domain === "ads_report" && query.adType) filters.push(Prisma.sql`s."adType"=${query.adType}`);
  if (domain === "performance") filters.push(Prisma.sql`s."onlySettle"=${query.onlySettle}`);
  const salesMetric = query.metric === "orders" ? "orders" : query.metric === "revenue" ? "revenue" : "quantity";
  const source = Prisma.raw(sources[domain]);
  const dim = Prisma.raw(`s."${query.dimension}"`); // query parser closed enum
  const identity = domain === "sales" && query.dimension === "parentAsin" ? Prisma.sql`l."parentAsin"` : dim;
  const baseIdentity = Prisma.sql`COALESCE(NULLIF(${identity},''), NULLIF(s.msku,''), s.id)`;
  const searchFields = [Prisma.sql`s.asin`, Prisma.sql`s.msku`, Prisma.sql`s.sku`, Prisma.sql`l.title`];
  if (domain === "ads_report") { searchFields.splice(2, 1); searchFields.push(Prisma.sql`s."campaignId"`, Prisma.sql`s."adGroupId"`); }
  if (domain === "sales" || domain === "performance") searchFields.push(identity);
  if (domain === "performance" || domain === "listings") searchFields.push(Prisma.sql`s.title`);
  const typedSearch: Record<string, Prisma.Sql> = { asin: Prisma.sql`s.asin`, msku: Prisma.sql`s.msku`, title: domain === "performance" || domain === "listings" ? Prisma.sql`s.title` : Prisma.sql`l.title` };
  if (domain !== "ads_report") typedSearch.sku = Prisma.sql`s.sku`;
  if (domain === "sales" || domain === "performance" || domain === "listings") typedSearch.parentAsin = domain === "sales" ? Prisma.sql`l."parentAsin"` : Prisma.sql`s."parentAsin"`;
  if (domain === "ads_report") { typedSearch.campaignId = Prisma.sql`s."campaignId"`; typedSearch.adGroupId = Prisma.sql`s."adGroupId"`; }
  const selectedSearch = query.searchType ? typedSearch[query.searchType] : undefined;
  if (query.searchType && !selectedSearch) throw new SellfoxBrowseError("当前域不支持该搜索类型。");
  if (query.search) filters.push(Prisma.sql`(${Prisma.join((selectedSearch ? [selectedSearch] : searchFields).map(field => query.exactMatch ? Prisma.sql`lower(${field})=lower(${query.search})` : Prisma.sql`${field} ILIKE ${`%${query.search}%`}`), " OR ")})`);
  const fields = domain === "sales" ? Prisma.sql`s.id,s."storeId",s."reportDate",s.asin,s.msku,s.sku,s.currency,s.quantity,s.revenue,s.orders,s.complete,${baseIdentity} AS identity`
    : domain === "performance" ? Prisma.sql`s.id,s."storeId",s."reportDate",s.asin,s.msku,s.sku,s.currency,s.title,s."parentAsin",s."saleQuantity",s."saleRevenue",s."grossProfit",s."adCost",s."orderNum",s."netRevenue",s."refundRate",s."fbaQuantity",s."fbmQuantity",${baseIdentity} AS identity`
    : Prisma.join(sellfoxAgentColumns[domain].map(key => Prisma.raw(`s."${key}"`)));
  const listing = Prisma.sql`listing AS (
    SELECT "storeId", msku, CASE WHEN count("parentAsin")=count(*) AND count(DISTINCT "parentAsin")=1 THEN min("parentAsin") END AS "parentAsin",
      CASE WHEN count(DISTINCT title)=1 THEN min(title) END AS title,
      CASE WHEN count("mainImage")=count(*) AND count(DISTINCT "mainImage")=1 THEN min("mainImage") END AS "mainImage",
      CASE WHEN count(price)=count(*) AND count(DISTINCT price)=1 THEN min(price) END AS price
    FROM sellfox_listing_current l WHERE ${scoped("l", scope)} AND msku IS NOT NULL GROUP BY "storeId",msku
  )`;
  const base = Prisma.sql`base AS (SELECT ${fields},st.name AS "storeName",st.marketplace AS "storeSite",
    l.title AS "listingTitle",l.price AS "listingPrice",l."parentAsin" AS "listingParentAsin",l."mainImage" AS "listingMainImage"
    FROM ${source} s JOIN "SellfoxStore" st ON st.id=s."storeId" AND ${scoped("st", scope)}
    LEFT JOIN listing l ON l."storeId"=s."storeId" AND l.msku=s.msku WHERE ${Prisma.join(filters, " AND ")})`;
  const safeSum = (key: string) => { const col = Prisma.raw(`"${key}"`); return Prisma.sql`CASE WHEN count(${col})=count(*) THEN sum(${col})::float END`; };
  const aggregateColumns = domain === "performance" ? ["saleQuantity", "saleRevenue", "grossProfit", "adCost", "orderNum", "netRevenue", "fbaQuantity", "fbmQuantity"] : ["impressions", "clicks", "cost", "adOrders", "adSales"];
  const groups = domain === "sales" ? Prisma.sql`days AS (
    SELECT "storeId",identity,currency,"reportDate",min(id) AS id,CASE WHEN count(DISTINCT asin)=1 THEN min(asin) END AS asin,CASE WHEN count(DISTINCT msku)=1 THEN min(msku) END AS msku,CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,
      min("storeName") AS name,min("storeSite") AS marketplace,CASE WHEN count("listingTitle")=count(*) AND count(DISTINCT "listingTitle")=1 THEN min("listingTitle") END AS title,CASE WHEN count("listingPrice")=count(*) AND count(DISTINCT "listingPrice")=1 THEN min("listingPrice") END AS price,CASE WHEN count("listingParentAsin")=count(*) AND count(DISTINCT "listingParentAsin")=1 THEN min("listingParentAsin") END AS "parentAsin",
      CASE WHEN count("listingMainImage")=count(*) AND count(DISTINCT "listingMainImage")=1 THEN min("listingMainImage") END AS "mainImage",
      CASE WHEN bool_and(complete AND orders IS NOT NULL) THEN sum(orders)::float END AS orders,
      CASE WHEN bool_and(complete AND quantity IS NOT NULL) THEN sum(quantity)::float END AS quantity,
      CASE WHEN bool_and(complete AND revenue IS NOT NULL) THEN sum(revenue)::float END AS revenue,
      array_agg(DISTINCT msku) AS members
    FROM base GROUP BY "storeId",identity,currency,"reportDate"
  ), grouped AS (
    SELECT "storeId",identity,currency,min(id) AS id,CASE WHEN count(DISTINCT asin)=1 THEN min(asin) END AS asin,CASE WHEN count(DISTINCT msku)=1 THEN min(msku) END AS msku,CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,min(name) AS name,min(marketplace) AS marketplace,CASE WHEN count(title)=count(*) AND count(DISTINCT title)=1 THEN min(title) END AS title,
      CASE WHEN count(price)=count(*) AND count(DISTINCT price)=1 THEN min(price) END AS price,CASE WHEN count("parentAsin")=count(*) AND count(DISTINCT "parentAsin")=1 THEN min("parentAsin") END AS "parentAsin",
      CASE WHEN count("mainImage")=count(*) AND count(DISTINCT "mainImage")=1 THEN min("mainImage") END AS "mainImage",
      jsonb_object_agg("reportDate",quantity) AS "dailyQuantity",jsonb_object_agg("reportDate",${Prisma.raw(salesMetric)}) AS daily,
      ${query.metric === "orders" ? Prisma.sql`CASE WHEN count(*)=${workbenchDateRange(query).length} THEN ${safeSum(salesMetric)} END` : safeSum(salesMetric)} AS subtotal,${safeSum("quantity")} AS quantity,
      count(*)::int AS "observedDays",(SELECT array_agg(DISTINCT b.msku) FROM base b WHERE b."storeId"=days."storeId" AND b.identity=days.identity AND b.currency IS NOT DISTINCT FROM days.currency) AS members
    FROM days GROUP BY "storeId",identity,currency
  )` : domain === "listings" ? Prisma.sql`grouped AS (SELECT base.* FROM base)` : Prisma.sql`grouped AS (
    SELECT "storeId",currency,${domain === "performance" ? Prisma.sql`identity` : Prisma.sql`"adType","campaignId","adGroupId","productId"`},
      min(id) AS id,min(asin) AS asin,min(msku) AS msku,${domain === "performance" ? Prisma.sql`CASE WHEN count("listingMainImage")=count(*) AND count(DISTINCT "listingMainImage")=1 THEN min("listingMainImage") END AS "mainImage",CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,CASE WHEN count(DISTINCT title)=1 THEN min(title) END AS title,CASE WHEN count(DISTINCT "parentAsin")=1 THEN min("parentAsin") END AS "parentAsin",CASE WHEN count(*)=1 THEN min("refundRate") END AS "refundRate",` : Prisma.sql`min("listingTitle") AS title,min("listingPrice") AS price,`}
      min("storeName") AS name,min("storeSite") AS marketplace,array_agg(DISTINCT msku) AS members,
      ${Prisma.join(aggregateColumns.map(key => Prisma.sql`${safeSum(key)} AS ${Prisma.raw(`"${key}"`)}`))}
    FROM base GROUP BY "storeId",currency,${domain === "performance" ? Prisma.sql`identity` : Prisma.sql`"adType","campaignId","adGroupId","productId"`}
  )`;
  const finalFilters = [Prisma.sql`true`];
  if (domain === "sales" && query.hideZero) finalFilters.push(Prisma.sql`quantity IS DISTINCT FROM 0`);
  if (domain === "ads_report" && query.quickFilter === "spend") finalFilters.push(Prisma.sql`cost>0`);
  if (domain === "ads_report" && query.quickFilter === "clicksNoOrders") finalFilters.push(Prisma.sql`clicks>0 AND "adOrders"=0`);
  if (domain === "ads_report" && query.quickFilter === "spendNoClicks") finalFilters.push(Prisma.sql`cost>0 AND clicks=0`);
  if (domain === "ads_report" && query.quickFilter === "noClicks") finalFilters.push(Prisma.sql`clicks=0`);
  const dailyTotals = domain === "sales" ? Prisma.sql`,(SELECT jsonb_object_agg(d.date,d.value) FROM (SELECT day.date,CASE WHEN count(day.value)=count(*) AND count(*)=(SELECT count(*) FROM filtered f WHERE f.currency IS NOT DISTINCT FROM filtered.currency) THEN sum(day.value::float) END AS value FROM filtered fday CROSS JOIN LATERAL jsonb_each_text(fday.daily) day(date,value) WHERE fday.currency IS NOT DISTINCT FROM filtered.currency GROUP BY day.date) d) AS daily` : Prisma.empty;
  const totalKeys = domain === "sales" ? ["subtotal"] : domain === "listings" ? [] : aggregateColumns;
  const totals = Prisma.sql`(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (SELECT currency,${totalKeys.length ? Prisma.join(totalKeys.map(key => Prisma.sql`${safeSum(key)} AS ${Prisma.raw(`"${key}"`)}`)) : Prisma.sql`count(*)::int AS count`}  ${dailyTotals} FROM filtered GROUP BY currency) t)`;
  return Prisma.sql`WITH ${listing},${base},${groups}, filtered AS (SELECT * FROM grouped WHERE ${Prisma.join(finalFilters, " AND ")})
    SELECT (SELECT count(*)::int FROM filtered) AS total,${totals} AS totals,
      COALESCE((SELECT jsonb_agg(p) FROM (SELECT * FROM filtered ORDER BY id LIMIT ${exporting ? sellfoxExportLimit + 1 : query.pageSize} OFFSET ${exporting ? 0 : (query.page - 1) * query.pageSize}) p),'[]'::jsonb) AS rows`;
}
export async function readSellfoxWorkbench(domain: WorkbenchDomain, query: SellfoxBrowseQuery, scope: Scope, exporting = false) {
  if (domain === "sales" || domain === "performance") query = await resolveEffectiveReportDate(domain, query, scope);
  const result = await prisma.$queryRaw<{ total: number; rows: Row[]; totals: Row[] }[]>(workbenchReadSql(domain, query, scope, exporting));
  const { rows, total, totals } = result[0];
  if (exporting && total > sellfoxExportLimit) throw new SellfoxBrowseError("筛选结果超过10,000条，请缩小范围；未导出部分文件。", 413);
  // Page-bounded supplemental lookup, never one network call per entity or full payload reads.
  const stores = [...new Set(rows.map(row => String(row.storeId)))];
  const mskus = [...new Set(rows.flatMap(row => Array.isArray(row.members) ? row.members.map(String) : row.msku ? [String(row.msku)] : []))];
  const inventory = stores.length ? await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT "storeId",msku,CASE WHEN count(quantity)=count(*) THEN sum(quantity)::float END AS fulfillable,CASE WHEN count("totalInventory")=count(*) THEN sum("totalInventory")::float END AS "totalInventory",max("capturedAt") AS "inventoryCapturedAt" FROM sellfox_inventory_current i WHERE ${scoped("i", scope)} AND "storeId" IN (${Prisma.join(stores)}) AND msku IN (${Prisma.join(mskus.length ? mskus : ["\u0001"])}) GROUP BY "storeId",msku`) : [];
  const stocksByKey = new Map(inventory.map(stock => [JSON.stringify([stock.storeId, stock.msku]), stock]));
  const dates = domain === "sales" ? workbenchDateRange(query) : domain === "performance" && query.reportDate && !query.from && !query.to ? [query.reportDate] : [];
  for (const row of rows) {
    const members = Array.isArray(row.members) ? row.members : [row.msku];
    const stocks = members.flatMap(msku => { const stock = stocksByKey.get(JSON.stringify([row.storeId, msku])); return stock ? [stock] : []; });
    if (["sales", "performance"].includes(domain) && members.length > 1) row.msku = null;
    for (const key of (domain === "listings" ? ["totalInventory"] : ["fulfillable", "totalInventory"])) row[key] = stocks.length === members.length && stocks.length > 0 && stocks.every(s => s[key] != null) ? stocks.reduce((sum, s) => sum + Number(s[key]), 0) : null;
    row.inventoryCapturedAt = stocks[0]?.inventoryCapturedAt ?? null;
    if (domain === "sales") { for (const date of dates) row[`day:${date}`] = (row.daily as Row)?.[date] ?? null;
      const values = dates.slice(-7).map(date => (row.dailyQuantity as Row)?.[date]);
      row.trend = values.length === 7 && values.every(v => v != null) ? values.join(" | ") : null;
      row.average7 = values.length === 7 && values.every(v => v != null) ? values.reduce<number>((n,v) => n + Number(v),0) / 7 : null;
    }
    if (domain === "performance") {
      row.grossProfitRate = row.grossProfit != null && Number(row.saleRevenue) > 0 ? Number(row.grossProfit) / Number(row.saleRevenue) : null;
      row.netProfitRate = row.grossProfit != null && Number(row.netRevenue) > 0 ? Number(row.grossProfit) / Number(row.netRevenue) : null;
    }
    if (domain === "ads_report") {
      row.acos = row.cost != null && Number(row.adSales) > 0 ? Number(row.cost) / Number(row.adSales) : null;
      row.roas = row.adSales != null && Number(row.cost) > 0 ? Number(row.adSales) / Number(row.cost) : null;
    }
  }
  return { rows, dates, totals, pagination: { page: query.page, pageSize: query.pageSize, total } };
}
