import { Prisma } from "@prisma/client";
import type { OperationsDailyMetric } from "./types";

export type DailyMetricsFilters = {
  from: string;
  to: string;
  sku: string;
  asin: string;
  page: number;
  pageSize: number;
};

export type DailyMetricAggregate = {
  reportDate: string;
  sku: string;
  asin: string;
  currency: string;
  _sum: { saleRevenue: number | null; adCost: number | null; saleQuantity: number | null };
};

export type InventorySnapshotFilters = { page: number; pageSize: number; sku: string };

export function buildInventorySnapshotWhere(input: { organizationId: string; workspaceId: string; syncRunId: string; sku: string }): Prisma.AmazonInventorySnapshotWhereInput {
  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    syncRunId: input.syncRunId,
    ...(input.sku ? { sellerSku: { contains: input.sku, mode: "insensitive" } } : {}),
  };
}

export function buildDailyMetricsWhere(input: { organizationId: string; workspaceId: string; filters: DailyMetricsFilters }): Prisma.SellfoxProductDailySnapshotWhereInput {
  const { filters } = input;
  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    reportDate: { gte: filters.from, lte: filters.to },
    ...(filters.sku ? { sku: { contains: filters.sku, mode: "insensitive" } } : {}),
    ...(filters.asin ? { asin: { equals: filters.asin, mode: "insensitive" } } : {}),
  };
}

export function parseDailyMetricsFilters(params: URLSearchParams, now = new Date()): DailyMetricsFilters | null {
  const today = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const from = params.get("from")?.trim() || defaultFrom;
  const to = params.get("to")?.trim() || today;
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return null;
  const rangeDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;
  if (rangeDays > 90) return null;

  return {
    from,
    to,
    sku: boundedText(params.get("sku"), 120),
    asin: boundedText(params.get("asin"), 40),
    page: boundedInteger(params.get("page"), 1, 100_000, 1),
    pageSize: boundedInteger(params.get("pageSize"), 1, 200, 50),
  };
}

export function parseInventorySnapshotFilters(params: URLSearchParams): InventorySnapshotFilters {
  return {
    page: boundedInteger(params.get("page"), 1, 100_000, 1),
    pageSize: boundedInteger(params.get("pageSize"), 1, 200, 50),
    sku: boundedText(params.get("sku"), 120),
  };
}

export function toDailyMetric(row: DailyMetricAggregate): OperationsDailyMetric {
  const salesValue = row._sum.saleRevenue;
  const adSpendValue = row._sum.adCost;
  const sales = typeof salesValue === "number" && salesValue > 0 ? salesValue : null;
  const adSpend = typeof adSpendValue === "number" ? adSpendValue : null;
  const tacos = sales !== null && adSpend !== null ? (adSpend / sales) * 100 : null;

  return {
    date: row.reportDate,
    sku: row.sku,
    asin: row.asin,
    currency: row.currency,
    sales,
    adSpend,
    tacos,
    fieldNotes: {
      sales: sales === null ? "日表现快照没有正销售额，按要求返回 null。" : null,
      adSpend: adSpend === null ? "来源报表未提供广告花费。" : null,
      tacos: tacos === null ? "缺少正销售额或广告花费，无法计算 TACOS。" : null,
    },
  };
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedInteger(value: string | null, minimum: number, maximum: number, fallback: number) {
  if (value === null || !/^\d+$/.test(value.trim())) return fallback;
  return Math.min(Math.max(Number(value), minimum), maximum);
}

function boundedText(value: string | null, maxLength: number) {
  return value?.trim().slice(0, maxLength) ?? "";
}
