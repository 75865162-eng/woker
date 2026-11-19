/**
 * P2 口径对账：同一 org/ws/日期窗，用「源表权威口径」与「聚合表」逐字段比对，
 * 只有 0 差异才允许把读路径从旧 CTE 切到聚合表。
 *
 * 金额一律用字符串比较（Decimal→string），避免浮点误差；缺失值两边都必须是 null，
 * 任一侧被补零都算差异（工程纪律：缺失不补零）。
 */
export type FieldDiff = { field: string; source: string | null; aggregate: string | null };
export type RowDiff = { key: string; fields: FieldDiff[] };
export type ReconcileReport = {
  scope: { organizationId: string; workspaceId: string; from: string; to: string };
  sourceRows: number;
  aggregateRows: number;
  diffs: RowDiff[];
  ok: boolean;
};

function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    // Prisma Decimal / Date both stringify deterministically here.
    return String(value);
  }
  return String(value);
}

/** Pure row comparator over an agreed field set. Missing on both sides = no diff. */
export function compareAggregateRows(
  source: Record<string, unknown>[],
  aggregate: Record<string, unknown>[],
  fields: string[],
  keyOf: (row: Record<string, unknown>) => string,
): ReconcileReport["diffs"] {
  const src = new Map(source.map((row) => [keyOf(row), row]));
  const agg = new Map(aggregate.map((row) => [keyOf(row), row]));
  const keys = new Set([...src.keys(), ...agg.keys()]);
  const diffs: RowDiff[] = [];
  for (const key of keys) {
    const s = src.get(key);
    const a = agg.get(key);
    const fieldDiffs: FieldDiff[] = [];
    for (const field of fields) {
      const sv = s ? norm(s[field]) : null;
      const av = a ? norm(a[field]) : null;
      if (sv !== av) fieldDiffs.push({ field, source: sv, aggregate: av });
    }
    if (fieldDiffs.length) diffs.push({ key, fields: fieldDiffs });
  }
  return diffs;
}

export const SALES_AGG_FIELDS = ["quantity", "orders", "revenueOriginal", "currencyOriginal", "complete"];
export const PROFIT_AGG_FIELDS = ["saleQuantity", "saleRevenue", "grossProfit", "netRevenue", "adCost", "currency"];
export const ADS_AGG_FIELDS = ["impressions", "clicks", "cost", "adOrders", "adSales", "currency"];
export const OVERVIEW_AGG_FIELDS = ["storeCount", "inventoryCount", "latestSalesDate", "latestProfitDate"];

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Reconcile SellfoxSalesAggDaily against the authoritative snapshot口径 for a window.
 * The source query mirrors the aggregate's GROUP BY exactly (same SUM/null-preserving
 * logic), so any diff indicates a stale or wrong aggregate — never a口径 drift.
 */
export async function reconcileSalesAggDaily(
  query: Query,
  scope: { organizationId: string; workspaceId: string; from: string; to: string },
): Promise<ReconcileReport> {
  const sourceRows = (await query(
    `SELECT t."storeId", t."msku", t."reportDate",
       SUM(t."quantity")::int AS "quantity", SUM(t."orders")::int AS "orders",
       CASE WHEN count(t."revenue")=count(*) THEN SUM(t."revenue")::text END AS "revenueOriginal",
       max(t."currency") AS "currencyOriginal",
       CASE WHEN bool_and(t."complete") IS NULL THEN NULL ELSE bool_and(t."complete") END AS "complete"
     FROM "SellfoxSalesDailySnapshot" t
     WHERE t."organizationId"=$1 AND t."workspaceId"=$2 AND t."reportDate" BETWEEN $3 AND $4
     GROUP BY t."storeId", t."msku", t."reportDate"`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const aggregateRows = (await query(
    `SELECT "storeId", "msku", "reportDate", "quantity", "orders",
       "revenueOriginal"::text AS "revenueOriginal", "currencyOriginal", "complete"
     FROM "SellfoxSalesAggDaily"
     WHERE "organizationId"=$1 AND "workspaceId"=$2 AND "reportDate" BETWEEN $3 AND $4`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const keyOf = (row: Record<string, unknown>) => `${row.storeId}|${row.msku}|${row.reportDate}`;
  const diffs = compareAggregateRows(sourceRows, aggregateRows, SALES_AGG_FIELDS, keyOf);
  return {
    scope,
    sourceRows: sourceRows.length,
    aggregateRows: aggregateRows.length,
    diffs,
    ok: diffs.length === 0 && sourceRows.length === aggregateRows.length,
  };
}

/**
 * Reconcile SellfoxProfitAggDaily against SellfoxProductDailySnapshot, mirroring
 * profitAggDailyStatement's null-preserving SUM/CASE口径 exactly.
 */
export async function reconcileProfitAggDaily(
  query: Query,
  scope: { organizationId: string; workspaceId: string; from: string; to: string },
): Promise<ReconcileReport> {
  const sourceRows = (await query(
    `SELECT t."storeId", t."msku", t."reportDate", t."onlySettle",
       CASE WHEN count(t."saleQuantity")=count(*) THEN SUM(t."saleQuantity") END::int AS "saleQuantity",
       CASE WHEN count(t."saleRevenue")=count(*) THEN SUM(t."saleRevenue")::text END AS "saleRevenue",
       CASE WHEN count(t."grossProfit")=count(*) THEN SUM(t."grossProfit")::text END AS "grossProfit",
       CASE WHEN count(t."netRevenue")=count(*) THEN SUM(t."netRevenue")::text END AS "netRevenue",
       CASE WHEN count(t."adCost")=count(*) THEN SUM(t."adCost")::text END AS "adCost",
       max(t."currency") AS "currency"
     FROM "SellfoxProductDailySnapshot" t
     JOIN "SellfoxStore" st ON st.id=t."storeId" AND st."organizationId"=$1 AND st."workspaceId"=$2
     WHERE t."organizationId"=$1 AND t."workspaceId"=$2 AND t."reportDate" BETWEEN $3 AND $4
     GROUP BY t."storeId", t."msku", t."reportDate", t."onlySettle"`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const aggregateRows = (await query(
    `SELECT "storeId", "msku", "reportDate", "onlySettle", "saleQuantity",
       "saleRevenue"::text AS "saleRevenue", "grossProfit"::text AS "grossProfit",
       "netRevenue"::text AS "netRevenue", "adCost"::text AS "adCost", "currency"
     FROM "SellfoxProfitAggDaily"
     WHERE "organizationId"=$1 AND "workspaceId"=$2 AND "reportDate" BETWEEN $3 AND $4`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const keyOf = (row: Record<string, unknown>) => `${row.storeId}|${row.msku}|${row.reportDate}|${row.onlySettle}`;
  const diffs = compareAggregateRows(sourceRows, aggregateRows, PROFIT_AGG_FIELDS, keyOf);
  return {
    scope,
    sourceRows: sourceRows.length,
    aggregateRows: aggregateRows.length,
    diffs,
    ok: diffs.length === 0 && sourceRows.length === aggregateRows.length,
  };
}

/**
 * Reconcile SellfoxAdsAggDaily against the UNION of the 6 ads daily tables,
 * mirroring adsAggDailyStatement's grouping and null-preserving口径 exactly.
 */
export async function reconcileAdsAggDaily(
  query: Query,
  scope: { organizationId: string; workspaceId: string; from: string; to: string },
): Promise<ReconcileReport> {
  const union = `
     SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'product' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsProductDaily"
     UNION ALL SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId",'targeting' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsTargetingDaily"
     UNION ALL SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId",NULL::text AS "adGroupId",NULL::text AS "targetingId",'campaign' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsCampaignDaily"
     UNION ALL SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'adGroup' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsAdGroupDaily"
     UNION ALL SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",NULL::text AS "targetingId",'placement' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsPlacementDaily"
     UNION ALL SELECT "organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId",'searchTerm' AS "entityType","impressions","clicks","cost","adOrders","adSales","currency" FROM "SellfoxAdsSearchTermDaily"`;
  const sourceRows = (await query(
    `SELECT src."storeId", src."reportDate", src."adType", src."campaignId", src."adGroupId", src."targetingId", src."entityType",
       SUM(src."impressions")::int AS "impressions", SUM(src."clicks")::int AS "clicks",
       CASE WHEN count(src."cost")=count(*) THEN SUM(src."cost")::text END AS "cost",
       SUM(src."adOrders")::int AS "adOrders",
       CASE WHEN count(src."adSales")=count(*) THEN SUM(src."adSales")::text END AS "adSales",
       max(src."currency") AS "currency"
     FROM (${union}) src
     JOIN "SellfoxStore" st ON st.id=src."storeId" AND st."organizationId"=$1 AND st."workspaceId"=$2
     WHERE src."organizationId"=$1 AND src."workspaceId"=$2 AND src."reportDate" BETWEEN $3 AND $4
     GROUP BY src."storeId",src."reportDate",src."adType",src."campaignId",src."adGroupId",src."targetingId",src."entityType"`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const aggregateRows = (await query(
    `SELECT "storeId", "reportDate", "adType", "campaignId", "adGroupId", "targetingId", "entityType",
       "impressions", "clicks", "cost"::text AS "cost", "adOrders", "adSales"::text AS "adSales", "currency"
     FROM "SellfoxAdsAggDaily"
     WHERE "organizationId"=$1 AND "workspaceId"=$2 AND "reportDate" BETWEEN $3 AND $4`,
    [scope.organizationId, scope.workspaceId, scope.from, scope.to],
  )).rows;

  const keyOf = (row: Record<string, unknown>) =>
    `${row.storeId}|${row.reportDate}|${row.adType}|${row.campaignId}|${row.adGroupId ?? "~"}|${row.targetingId ?? "~"}|${row.entityType}`;
  const diffs = compareAggregateRows(sourceRows, aggregateRows, ADS_AGG_FIELDS, keyOf);
  return {
    scope,
    sourceRows: sourceRows.length,
    aggregateRows: aggregateRows.length,
    diffs,
    ok: diffs.length === 0 && sourceRows.length === aggregateRows.length,
  };
}

/**
 * Reconcile SellfoxOverviewAgg against its source counts, mirroring overviewAggStatement.
 * This is a whole-workspace single-row rollup (no date window), so the report's
 * from/to are informational only.
 */
export async function reconcileOverviewAgg(
  query: Query,
  scope: { organizationId: string; workspaceId: string; from: string; to: string },
): Promise<ReconcileReport> {
  const sourceRows = (await query(
    `SELECT
       (SELECT count(*)::int FROM "SellfoxStore" st WHERE st."organizationId"=$1 AND st."workspaceId"=$2) AS "storeCount",
       (SELECT count(*)::int FROM "SellfoxFbaInventorySnapshot" i WHERE i."organizationId"=$1 AND i."workspaceId"=$2) AS "inventoryCount",
       (SELECT max("reportDate") FROM "SellfoxSalesDailySnapshot" WHERE "organizationId"=$1 AND "workspaceId"=$2) AS "latestSalesDate",
       (SELECT max("reportDate") FROM "SellfoxProductDailySnapshot" WHERE "organizationId"=$1 AND "workspaceId"=$2) AS "latestProfitDate"`,
    [scope.organizationId, scope.workspaceId],
  )).rows;

  const aggregateRows = (await query(
    `SELECT "storeCount", "inventoryCount", "latestSalesDate", "latestProfitDate"
     FROM "SellfoxOverviewAgg" WHERE "organizationId"=$1 AND "workspaceId"=$2`,
    [scope.organizationId, scope.workspaceId],
  )).rows;

  const keyOf = () => "overview";
  const diffs = compareAggregateRows(sourceRows, aggregateRows, OVERVIEW_AGG_FIELDS, keyOf);
  return {
    scope,
    sourceRows: sourceRows.length,
    aggregateRows: aggregateRows.length,
    diffs,
    ok: diffs.length === 0 && sourceRows.length === aggregateRows.length,
  };
}

/** Guard used by tooling: throw unless the report is clean. Keeps cutover explicit. */
export function assertReconciled(report: ReconcileReport) {
  if (!report.ok) {
    const sample = report.diffs.slice(0, 5).map((d) => `${d.key}: ${d.fields.map((f) => `${f.field}(${f.source}=>${f.aggregate})`).join(",")}`).join("; ");
    throw new Error(`聚合口径对账未通过：source=${report.sourceRows} aggregate=${report.aggregateRows} diffRows=${report.diffs.length}${sample ? ` 样例=${sample}` : ""}`);
  }
}
