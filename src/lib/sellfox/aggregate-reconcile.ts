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

/** Guard used by tooling: throw unless the report is clean. Keeps cutover explicit. */
export function assertReconciled(report: ReconcileReport) {
  if (!report.ok) {
    const sample = report.diffs.slice(0, 5).map((d) => `${d.key}: ${d.fields.map((f) => `${f.field}(${f.source}=>${f.aggregate})`).join(",")}`).join("; ");
    throw new Error(`聚合口径对账未通过：source=${report.sourceRows} aggregate=${report.aggregateRows} diffRows=${report.diffs.length}${sample ? ` 样例=${sample}` : ""}`);
  }
}
