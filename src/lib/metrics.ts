import type { MetricSnapshot, PerformanceRow } from "@/lib/types";

export function enrichMetric(row: PerformanceRow, metric: string): number {
  const spend = row.spend;
  const sales = row.sales;
  const clicks = row.clicks;
  const impressions = row.impressions;
  const orders = row.orders;

  switch (metric) {
    case "acos":
      return sales > 0 ? (spend / sales) * 100 : spend > 0 ? 999 : 0;
    case "roas":
      return spend > 0 ? sales / spend : 0;
    case "ctr":
      return impressions > 0 ? (clicks / impressions) * 100 : 0;
    case "cpc":
      return clicks > 0 ? spend / clicks : 0;
    case "cvr":
      return clicks > 0 ? (orders / clicks) * 100 : 0;
    case "cpa":
      return orders > 0 ? spend / orders : spend;
    case "acots":
      return sales > 0 ? (spend / (sales * 1.18)) * 100 : 0;
    case "asots":
      return sales > 0 ? (sales / (sales * 1.32)) * 100 : 0;
    default:
      return Number(row[metric as keyof PerformanceRow] ?? 0);
  }
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
    acos: totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0,
    roas: totals.spend > 0 ? totals.sales / totals.spend : 0,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    cvr: totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0,
  };
}

export function aggregateMetricsForCampaignGroups(
  campaignGroupIds: string[],
  rows: PerformanceRow[],
): MetricSnapshot {
  const scopedRows = rows.filter((row) => campaignGroupIds.includes(row.campaignGroupId));
  const totals = scopedRows.reduce(
    (acc, row) => {
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
    acos: totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0,
    roas: totals.spend > 0 ? totals.sales / totals.spend : 0,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    cvr: totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0,
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

export function formatPercent(value: number): string {
  return `${formatNumber(value, 1)}%`;
}
