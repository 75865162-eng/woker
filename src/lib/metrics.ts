import type { MetricSnapshot, PerformanceRow } from "@/lib/types";
import { computeMetric, type ObservedMetrics } from "@/lib/metrics-registry";

function requireObservedMetrics(row: PerformanceRow) {
  for (const key of ["sales", "spend", "orders", "impressions", "clicks"] as const) {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0) {
      throw new Error(`NEEDS_DATA: ${key}`);
    }
  }
}

export function enrichMetric(row: PerformanceRow, metric: "roas" | "ctr" | "cpc" | "cvr" | "cpa" | "acots" | "asots"): number;
export function enrichMetric(row: PerformanceRow, metric: string): number | null;
export function enrichMetric(row: PerformanceRow, metric: string): number | null {
  requireObservedMetrics(row);
  const spend = row.spend;
  const sales = row.sales;
  const clicks = row.clicks;
  const impressions = row.impressions;
  const orders = row.orders;

  const observed: ObservedMetrics = { spend, sales, clicks, impressions, orders };
  const derived = computeMetric(metric, observed);
  // 仅当 metric 是已注册的派生指标时返回结果；否则回退读取 row 上的原始字段。
  if (derived !== null) return derived;
  // ACOS 在零分母时合法地返回 null，需与"未知指标"区分。
  if (metric === "acos") return null;
  return typeof row[metric as keyof PerformanceRow] === "number" ? row[metric as keyof PerformanceRow] as number : null;
}

export function aggregateMetrics(
  campaignGroupId: string,
  batchId: string,
  rows: PerformanceRow[],
): MetricSnapshot {
  const scopedRows = rows.filter(
    (row) => row.campaignGroupId === campaignGroupId && row.batchId === batchId,
  );
  const totals = scopedRows.reduce(
    (acc, row) => {
      requireObservedMetrics(row);
      acc.sales += row.sales;
      acc.spend += row.spend;
      acc.orders += row.orders;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      return acc;
    },
    { sales: 0, spend: 0, orders: 0, impressions: 0, clicks: 0 },
  );

  return {
    campaignGroupId,
    batchId,
    sales: totals.sales,
    spend: totals.spend,
    orders: totals.orders,
    impressions: totals.impressions,
    clicks: totals.clicks,
    acos: computeMetric("acos", totals),
    roas: computeMetric("roas", totals) ?? 0,
    ctr: computeMetric("ctr", totals) ?? 0,
    cpc: computeMetric("cpc", totals) ?? 0,
    cvr: computeMetric("cvr", totals) ?? 0,
  };
}

export function aggregateMetricsForCampaignGroups(
  campaignGroupIds: string[],
  rows: PerformanceRow[],
): MetricSnapshot {
  const scopedRows = rows.filter((row) => campaignGroupIds.includes(row.campaignGroupId));
  const totals = scopedRows.reduce(
    (acc, row) => {
      requireObservedMetrics(row);
      acc.sales += row.sales;
      acc.spend += row.spend;
      acc.orders += row.orders;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      return acc;
    },
    { sales: 0, spend: 0, orders: 0, impressions: 0, clicks: 0 },
  );

  return {
    campaignGroupId: campaignGroupIds.join(","),
    batchId: "aggregated",
    sales: totals.sales,
    spend: totals.spend,
    orders: totals.orders,
    impressions: totals.impressions,
    clicks: totals.clicks,
    acos: computeMetric("acos", totals),
    roas: computeMetric("roas", totals) ?? 0,
    ctr: computeMetric("ctr", totals) ?? 0,
    cpc: computeMetric("cpc", totals) ?? 0,
    cvr: computeMetric("cvr", totals) ?? 0,
  };
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${formatNumber(value, 1)}%`;
}
