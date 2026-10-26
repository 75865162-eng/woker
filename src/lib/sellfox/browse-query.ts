import type { Prisma } from "@prisma/client";
import { isSellfoxDate, sellfoxDateAt } from "@/lib/sellfox/sync-contract";

export class SellfoxBrowseError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export type SellfoxBrowseDomain = "stores" | "inventory" | "sales" | "performance" | "hourly" | "runs" | "listings" | "ads_report" | "ads_targeting" | "ads_search_term" | "ads_campaign" | "ads_ad_group" | "ads_placement";
export type SellfoxBrowseDimension = "asin" | "parentAsin" | "msku" | "sku" | "store" | "developer" | "spu";
export const sellfoxBrowseDomains: SellfoxBrowseDomain[] = ["stores", "inventory", "sales", "performance", "hourly", "runs", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"];
export const sellfoxExportLimit = 10_000;
export function sellfoxFulfillment(value: string | null | undefined): "" | "AFN" | "MFN" {
  return value === "AFN" || value === "MFN" ? value : "";
}
export function sellfoxBuyBox(value: string | null | undefined): "" | "yes" | "no" {
  return value === "yes" || value === "no" ? value : "";
}
export function sellfoxProductTag(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
export function sellfoxBrand(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
export function sellfoxBrowseQuery(url: URL) {
  const p = url.searchParams;
  function integer(key: string, fallback: number, max: number) {
    const value = p.get(key); if (!value) return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new SellfoxBrowseError(`${key} 必须是 1–${max} 的整数。`);
    return number;
  }
  function date(key: string) {
    const value = p.get(key)?.trim(); if (!value) return undefined;
    if (!isSellfoxDate(value)) throw new SellfoxBrowseError("日期必须使用有效 YYYY-MM-DD 格式。");
    return value;
  }
  const from = date("from"), to = date("to"), reportDate = date("reportDate");
  if (from && to && from > to) throw new SellfoxBrowseError("结束日期不得早于开始日期。");
  return {
    layout: p.get("layout") === "workbench", fulfillment: sellfoxFulfillment(p.get("fulfillment")), buyBox: sellfoxBuyBox(p.get("buyBox")), productTag: sellfoxProductTag(p.get("productTag")), brand: sellfoxBrand(p.get("brand")),
    dimension: (["asin", "parentAsin", "msku", "sku", "store", "developer", "spu"].includes(p.get("dimension") ?? "") ? p.get("dimension") : "msku") as SellfoxBrowseDimension,
    metric: p.get("metric") === "revenue" ? "revenue" : p.get("metric") === "orders" ? "orders" : "quantity", onlySettle: p.get("onlySettle") === "1", hideZero: p.get("hideZero") === "1",
    currency: p.get("currency")?.trim() ?? "", adType: ["sp", "sb", "sd"].includes(p.get("adType") ?? "") ? p.get("adType")! : "",
    quickFilter: ["spend", "clicksNoOrders", "spendNoClicks", "noClicks"].includes(p.get("quickFilter") ?? "") ? p.get("quickFilter")! : "",
    page: integer("page", 1, 1_000_000), pageSize: integer("pageSize", 50, 200), from, to, reportDate,
    status: p.get("status")?.trim() || undefined,
    searchType: ["asin", "msku", "sku", "parentAsin", "title", "campaignId", "adGroupId", "targetingId", "searchTerm", "placement"].includes(p.get("searchType") ?? "") ? p.get("searchType")! : "", exactMatch: p.get("exactMatch") === "1",
    search: p.get("search")?.trim() ?? "", site: p.get("site")?.trim() ?? "", allDates: p.get("allDates") === "1",
    shopExternalIds: [...new Set(p.getAll("shopExternalId").map((value) => value.trim()).filter(Boolean))],
    storeId: p.get("storeId")?.trim() || undefined,
  };
}
export type SellfoxBrowseQuery = ReturnType<typeof sellfoxBrowseQuery>;
export function sellfoxDateFilter(query: SellfoxBrowseQuery, defaultYesterday = false) {
  if (query.from || query.to) return { reportDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } };
  if (query.reportDate) return { reportDate: query.reportDate };
  return defaultYesterday && !query.allDates ? { reportDate: sellfoxDateAt(new Date(), -1) } : {};
}
export function sellfoxStoreWhere(query: SellfoxBrowseQuery, organizationId: string, workspaceId: string, storeIds?: string[]): Prisma.SellfoxStoreWhereInput {
  return {
    organizationId, workspaceId, ...(storeIds ? { id: { in: storeIds } } : {}), ...(query.site ? { marketplace: query.site } : {}),
    ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { externalId: { contains: query.search } }, { marketplace: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
}
export function sellfoxSnapshotWhere(query: SellfoxBrowseQuery, organizationId: string, workspaceId: string, storeIds?: string[], performance = false) {
  return {
    organizationId, workspaceId, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...sellfoxDateFilter(query, performance), ...(performance ? { onlySettle: query.onlySettle } : {}),
    ...(query.site ? { SellfoxStore: { marketplace: query.site } } : {}),
    ...(query.search ? { OR: (performance ? ["sku", "msku", "asin", "title"] : ["sku", "msku", "asin"]).map((field) => ({ [field]: { contains: query.search, mode: "insensitive" as const } })) } : {}),
  };
}
export function sellfoxHourlyWhere(query: SellfoxBrowseQuery, organizationId: string, workspaceId: string, storeIds?: string[]): Prisma.SellfoxHourlyMetricWhereInput {
  return {
    organizationId, workspaceId, ...(storeIds ? { storeId: { in: storeIds } } : {}), ...sellfoxDateFilter(query),
    ...(query.site ? { SellfoxStore: { marketplace: query.site } } : {}),
    ...(query.search ? { OR: ["entityId", "entityName"].map((field) => ({ [field]: { contains: query.search, mode: "insensitive" as const } })) } : {}),
  };
}
export function sellfoxRunWhere(query: SellfoxBrowseQuery, organizationId: string, workspaceId: string): Prisma.SellfoxSyncRunWhereInput {
  const from = query.from ?? query.reportDate; const to = query.to ?? query.reportDate;
  const endExclusive = to ? new Date(Date.parse(`${to}T00:00:00+08:00`) + 86_400_000) : undefined;
  return {
    organizationId, workspaceId,
    ...(from || to ? { startedAt: { ...(from ? { gte: new Date(`${from}T00:00:00+08:00`) } : {}), ...(endExclusive ? { lt: endExclusive } : {}) } } : {}),
    ...(query.search ? { OR: [{ id: { contains: query.search, mode: "insensitive" } }, { resource: { contains: query.search, mode: "insensitive" } }, { status: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
}
export function assertSellfoxExportComplete(rows: unknown[]) {
  if (rows.length > sellfoxExportLimit) throw new SellfoxBrowseError("筛选结果超过 10,000 条，请缩小日期或店铺范围后导出；未导出部分文件。", 413);
}
