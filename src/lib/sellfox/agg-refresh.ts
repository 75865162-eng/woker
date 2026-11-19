import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * P2 L4 — incremental refresh of the pre-aggregated tables from source snapshots/views.
 *
 * Design rules (from the整改方案):
 *  - Derived only: every aggregate is recomputed from source rows, never a new fact.
 *  - Idempotent: INSERT ... SELECT ... ON CONFLICT DO UPDATE so a re-run is safe.
 *  - Scoped: always organizationId + workspaceId + the synced store/date window.
 *  - NULL-preserving: SUM/AVG use `CASE WHEN count(col)=count(*) THEN ... END`, so a
 *    dimension with any missing component stays NULL instead of being padded to 0.
 *  - Amount口径: DECIMAL(20,4), matching the repo-wide stored口径.
 *  - Off by default: the caller (post-sync-projections) gates this on SELLFOX_AGG_READ_ENABLED.
 */
export type AggDb = { $executeRaw: (sql: Prisma.Sql) => Promise<number> };

export type AggRefreshInput = {
  organizationId: string;
  workspaceId: string;
  resource: string;
  shopExternalIds: string[];
  reportDate?: string;
  startDate?: string;
  endDate?: string;
  runId: string;
};

const ADS_RESOURCES = new Set(["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]);

/** Deterministic id so upserts are stable across re-runs. */
export function aggId(...parts: Array<string | number | boolean | null | undefined>) {
  // simple stable join; collision risk is negligible within a tenant and keeps this pure/testable
  return parts.map((p) => (p == null ? "~" : String(p))).join("|");
}

/** Build the sales-daily aggregate refresh statement (pure, testable SQL). */
export function salesAggDailyStatement(input: AggRefreshInput) {
  const from = input.reportDate ?? input.startDate;
  const to = input.reportDate ?? input.endDate;
  if (!from || !to) return null;
  return Prisma.sql`
    INSERT INTO "SellfoxSalesAggDaily"
      ("id","organizationId","workspaceId","storeId","msku","asin","reportDate",
       "quantity","orders","revenueOriginal","currencyOriginal","complete","sourceCapturedAt","refreshedAt")
    SELECT
      ${Prisma.sql`concat('salesagg|', t."storeId", '|', t."msku", '|', t."reportDate")::text`},
      t."organizationId", t."workspaceId", t."storeId", t."msku", max(t."asin"), t."reportDate",
      SUM(t."quantity")::int, SUM(t."orders")::int,
      CASE WHEN count(t."revenue")=count(*) THEN SUM(t."revenue") END,
      max(t."currency"),
      CASE WHEN bool_and(t."complete") IS NULL THEN NULL ELSE bool_and(t."complete") END,
      max(t."syncedAt"), now()
    FROM "SellfoxSalesDailySnapshot" t
    JOIN "SellfoxStore" st ON st.id=t."storeId" AND st."organizationId"=${input.organizationId} AND st."workspaceId"=${input.workspaceId}
    WHERE t."organizationId"=${input.organizationId} AND t."workspaceId"=${input.workspaceId}
      AND t."reportDate" >= ${from} AND t."reportDate" <= ${to}
      AND (${input.shopExternalIds.length === 0} OR st."externalId" = ANY(${input.shopExternalIds}::text[]))
    GROUP BY t."organizationId", t."workspaceId", t."storeId", t."msku", t."reportDate"
    ON CONFLICT ("organizationId","workspaceId","storeId","msku","reportDate") DO UPDATE SET
      "asin"=EXCLUDED."asin", "quantity"=EXCLUDED."quantity", "orders"=EXCLUDED."orders",
      "revenueOriginal"=EXCLUDED."revenueOriginal", "currencyOriginal"=EXCLUDED."currencyOriginal",
      "complete"=EXCLUDED."complete", "sourceCapturedAt"=EXCLUDED."sourceCapturedAt", "refreshedAt"=now()
  `;
}

/** Build the profit-daily aggregate refresh statement (pure, testable SQL). */
export function profitAggDailyStatement(input: AggRefreshInput) {
  const from = input.reportDate ?? input.startDate;
  const to = input.reportDate ?? input.endDate;
  if (!from || !to) return null;
  return Prisma.sql`
    INSERT INTO "SellfoxProfitAggDaily"
      ("id","organizationId","workspaceId","storeId","msku","reportDate","onlySettle",
       "saleQuantity","saleRevenue","grossProfit","netRevenue","adCost","currency","sourceCapturedAt","refreshedAt")
    SELECT
      concat('profitagg|', t."storeId", '|', t."msku", '|', t."reportDate", '|', t."onlySettle")::text,
      t."organizationId", t."workspaceId", t."storeId", t."msku", t."reportDate", t."onlySettle",
      CASE WHEN count(t."saleQuantity")=count(*) THEN SUM(t."saleQuantity") END::int,
      CASE WHEN count(t."saleRevenue")=count(*) THEN SUM(t."saleRevenue") END,
      CASE WHEN count(t."grossProfit")=count(*) THEN SUM(t."grossProfit") END,
      CASE WHEN count(t."netRevenue")=count(*) THEN SUM(t."netRevenue") END,
      CASE WHEN count(t."adCost")=count(*) THEN SUM(t."adCost") END,
      max(t."currency"), max(t."syncedAt"), now()
    FROM "SellfoxProductDailySnapshot" t
    JOIN "SellfoxStore" st ON st.id=t."storeId" AND st."organizationId"=${input.organizationId} AND st."workspaceId"=${input.workspaceId}
    WHERE t."organizationId"=${input.organizationId} AND t."workspaceId"=${input.workspaceId}
      AND t."reportDate" >= ${from} AND t."reportDate" <= ${to}
      AND (${input.shopExternalIds.length === 0} OR st."externalId" = ANY(${input.shopExternalIds}::text[]))
    GROUP BY t."organizationId", t."workspaceId", t."storeId", t."msku", t."reportDate", t."onlySettle"
    ON CONFLICT ("organizationId","workspaceId","storeId","msku","reportDate","onlySettle") DO UPDATE SET
      "saleQuantity"=EXCLUDED."saleQuantity", "saleRevenue"=EXCLUDED."saleRevenue",
      "grossProfit"=EXCLUDED."grossProfit", "netRevenue"=EXCLUDED."netRevenue",
      "adCost"=EXCLUDED."adCost", "currency"=EXCLUDED."currency",
      "sourceCapturedAt"=EXCLUDED."sourceCapturedAt", "refreshedAt"=now()
  `;
}

/** Build the ads-daily aggregate refresh statement (pure, testable SQL). */
export function adsAggDailyStatement(input: AggRefreshInput) {
  const from = input.reportDate ?? input.startDate;
  const to = input.reportDate ?? input.endDate;
  if (!from || !to) return null;
  return Prisma.sql`
    INSERT INTO "SellfoxAdsAggDaily"
      ("id","organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId","entityType",
       "impressions","clicks","cost","adOrders","adSales","currency","sourceCapturedAt","refreshedAt")
    SELECT
      concat('adsagg|', src."storeId", '|', src."reportDate", '|', src."adType", '|', src."campaignId", '|', coalesce(src."adGroupId",'~'), '|', coalesce(src."targetingId",'~'), '|', src."entityType")::text,
      src."organizationId", src."workspaceId", src."storeId", src."reportDate", src."adType",
      src."campaignId", src."adGroupId", src."targetingId", src."entityType",
      SUM(src."impressions")::int, SUM(src."clicks")::int,
      CASE WHEN count(src."cost")=count(*) THEN SUM(src."cost") END,
      SUM(src."adOrders")::int,
      CASE WHEN count(src."adSales")=count(*) THEN SUM(src."adSales") END,
      max(src."currency"), max(src."syncedAt"), now()
    FROM (
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'product' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsProductDaily"
      UNION ALL
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId",'targeting' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsTargetingDaily"
      UNION ALL
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId",NULL::text AS "adGroupId",NULL::text AS "targetingId",'campaign' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsCampaignDaily"
      UNION ALL
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'adGroup' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsAdGroupDaily"
      UNION ALL
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'placement' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsPlacementDaily"
      UNION ALL
      SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId",'searchTerm' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency","syncedAt" FROM "SellfoxAdsSearchTermDaily"
    ) src
    JOIN "SellfoxStore" st ON st.id=src."storeId" AND st."organizationId"=${input.organizationId} AND st."workspaceId"=${input.workspaceId}
    WHERE src."organizationId"=${input.organizationId} AND src."workspaceId"=${input.workspaceId}
      AND src."reportDate" >= ${from} AND src."reportDate" <= ${to}
      AND (${input.shopExternalIds.length === 0} OR st."externalId" = ANY(${input.shopExternalIds}::text[]))
    GROUP BY src."organizationId",src."workspaceId",src."storeId",src."reportDate",src."adType",src."campaignId",src."adGroupId",src."targetingId",src."entityType"
    ON CONFLICT ("organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId","entityType") DO UPDATE SET
      "impressions"=EXCLUDED."impressions", "clicks"=EXCLUDED."clicks", "cost"=EXCLUDED."cost",
      "adOrders"=EXCLUDED."adOrders", "adSales"=EXCLUDED."adSales", "currency"=EXCLUDED."currency",
      "sourceCapturedAt"=EXCLUDED."sourceCapturedAt", "refreshedAt"=now()
  `;
}

/** Build the overview-aggregate refresh statement (pure, testable SQL). */
export function overviewAggStatement(input: AggRefreshInput) {
  return Prisma.sql`
    INSERT INTO "SellfoxOverviewAgg"
      ("organizationId","workspaceId","storeCount","inventoryCount","latestSalesDate","latestProfitDate","sourceVersion","refreshedAt")
    SELECT
      ${input.organizationId}, ${input.workspaceId},
      (SELECT count(*)::int FROM "SellfoxStore" st WHERE st."organizationId"=${input.organizationId} AND st."workspaceId"=${input.workspaceId}),
      (SELECT count(*)::int FROM "SellfoxFbaInventorySnapshot" i WHERE i."organizationId"=${input.organizationId} AND i."workspaceId"=${input.workspaceId}),
      (SELECT max("reportDate") FROM "SellfoxSalesDailySnapshot" WHERE "organizationId"=${input.organizationId} AND "workspaceId"=${input.workspaceId}),
      (SELECT max("reportDate") FROM "SellfoxProductDailySnapshot" WHERE "organizationId"=${input.organizationId} AND "workspaceId"=${input.workspaceId}),
      ${input.runId}, now()
    ON CONFLICT ("organizationId","workspaceId") DO UPDATE SET
      "storeCount"=EXCLUDED."storeCount", "inventoryCount"=EXCLUDED."inventoryCount",
      "latestSalesDate"=EXCLUDED."latestSalesDate", "latestProfitDate"=EXCLUDED."latestProfitDate",
      "sourceVersion"=EXCLUDED."sourceVersion", "refreshedAt"=now()
  `;
}

/**
 * Build the inventory-current aggregate refresh statement (pure, testable SQL).
 * Source is the `sellfox_inventory_current` view, which already de-duplicates to the
 * latest complete capture per store via SellfoxSnapshotHead. We roll it up to
 * (org, ws, storeId, msku); NULL-preserving SUM keeps missing components as NULL.
 * `warehouseCount` = number of warehouse/source rows folded into the SKU.
 */
export function inventoryAggStatement(input: AggRefreshInput) {
  return Prisma.sql`
    INSERT INTO "SellfoxInventoryAgg"
      ("id","organizationId","workspaceId","storeId","msku","asin",
       "quantity","totalInventory","inTransit","inboundWorking","inboundShipped","inboundReceiving",
       "reservedTransfer","reservedProcessing","reservedCustomerorders","unfulfillable",
       "avgInventoryCost","avgTransportCost","currency","warehouseCount","sourceCapturedAt","refreshedAt")
    SELECT
      concat('invagg|', i."storeId", '|', i."msku")::text,
      i."organizationId", i."workspaceId", i."storeId", i."msku", max(i.asin),
      CASE WHEN count(i."quantity")=count(*) THEN SUM(i."quantity")::int END,
      CASE WHEN count(i."totalInventory")=count(*) THEN SUM(i."totalInventory")::int END,
      CASE WHEN count(i."inTransit")=count(*) THEN SUM(i."inTransit")::int END,
      CASE WHEN count(i."inboundWorking")=count(*) THEN SUM(i."inboundWorking")::int END,
      CASE WHEN count(i."inboundShipped")=count(*) THEN SUM(i."inboundShipped")::int END,
      CASE WHEN count(i."inboundReceiving")=count(*) THEN SUM(i."inboundReceiving")::int END,
      CASE WHEN count(i."reservedTransfer")=count(*) THEN SUM(i."reservedTransfer")::int END,
      CASE WHEN count(i."reservedProcessing")=count(*) THEN SUM(i."reservedProcessing")::int END,
      CASE WHEN count(i."reservedCustomerorders")=count(*) THEN SUM(i."reservedCustomerorders")::int END,
      CASE WHEN count(i.unfulfillable)=count(*) THEN SUM(i.unfulfillable)::int END,
      max(i."avgInventoryCost"), max(i."avgTransportCost"),
      max(i.currency), count(*)::int, max(i."capturedAt"), now()
    FROM sellfox_inventory_current i
    WHERE i."organizationId"=${input.organizationId} AND i."workspaceId"=${input.workspaceId}
      AND (${input.shopExternalIds.length === 0} OR i."shopExternalId" = ANY(${input.shopExternalIds}::text[]))
    GROUP BY i."organizationId", i."workspaceId", i."storeId", i."msku"
    ON CONFLICT ("organizationId","workspaceId","storeId","msku") DO UPDATE SET
      "asin"=EXCLUDED."asin", "quantity"=EXCLUDED."quantity", "totalInventory"=EXCLUDED."totalInventory",
      "inTransit"=EXCLUDED."inTransit", "inboundWorking"=EXCLUDED."inboundWorking",
      "inboundShipped"=EXCLUDED."inboundShipped", "inboundReceiving"=EXCLUDED."inboundReceiving",
      "reservedTransfer"=EXCLUDED."reservedTransfer", "reservedProcessing"=EXCLUDED."reservedProcessing",
      "reservedCustomerorders"=EXCLUDED."reservedCustomerorders", "unfulfillable"=EXCLUDED."unfulfillable",
      "avgInventoryCost"=EXCLUDED."avgInventoryCost", "avgTransportCost"=EXCLUDED."avgTransportCost",
      "currency"=EXCLUDED."currency", "warehouseCount"=EXCLUDED."warehouseCount",
      "sourceCapturedAt"=EXCLUDED."sourceCapturedAt", "refreshedAt"=now()
  `;
}

/** Which aggregate statements apply to a given synced resource. */
export function aggregateStatementsFor(input: AggRefreshInput) {
  const list: Array<{ name: string; sql: Prisma.Sql | null }> = [];
  if (input.resource === "sales") list.push({ name: "sales_daily", sql: salesAggDailyStatement(input) });
  if (input.resource === "performance") list.push({ name: "profit_daily", sql: profitAggDailyStatement(input) });
  if (ADS_RESOURCES.has(input.resource)) list.push({ name: "ads_daily", sql: adsAggDailyStatement(input) });
  // inventory-current aggregate: refresh after any inventory sync.
  if (input.resource === "inventory") list.push({ name: "inventory_current", sql: inventoryAggStatement(input) });
  // Overview is a cheap whole-workspace rollup; refresh it after any fact-domain sync.
  if (["sales", "performance", "inventory", "stores", ...ADS_RESOURCES].includes(input.resource)) {
    list.push({ name: "overview", sql: overviewAggStatement(input) });
  }
  return list.filter((item): item is { name: string; sql: Prisma.Sql } => item.sql !== null);
}

export async function refreshSellfoxAggregates(input: AggRefreshInput, db: AggDb = prisma) {
  const statements = aggregateStatementsFor(input);
  for (const statement of statements) {
    await db.$executeRaw(statement.sql);
  }
  return { refreshed: statements.map((s) => s.name) };
}
