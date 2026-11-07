import { notificationTypes } from "./notification-types";
import { parseBrandCollection, type BrandCollection } from "./brand-collection";
import { assertProductAccessEvidence, type ProductAccessContext } from "./product-access-evidence";
import { reportTimeZone } from "./date-range";
import { SyncInputError } from "./policy";

export const observationResources = ["fulfillment", "pricing", "brand_analytics", "buy_box_history", "listing_details", "catalog_items", "notifications"] as const;
export type ObservationResource = typeof observationResources[number];
export const brandReportTypes = {
  search_terms: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT",
  search_query: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
  search_catalog: "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT",
  market_basket: "GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT",
  repeat_purchase: "GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT",
} as const;
export type BrandReportKind = keyof typeof brandReportTypes;
export type ReportPeriod = "DAY" | "WEEK" | "MONTH" | "QUARTER";
type CommonPolicy = { resource: ObservationResource; applicationId: string; maxRequests: number; maxRows: number; requestsPerSecond: number };
export type InboundPolicy = CommonPolicy & { resource: "fulfillment"; planIds: string[]; discoverPlans?: true };
export type PricingPolicy = CommonPolicy & ProductOptions & { resource: "pricing"; asins: string[] };
export type AnalyticsPolicy = CommonPolicy & { resource: "brand_analytics"; automaticDiscovery?: true; collection?: BrandCollection; reportKind: BrandReportKind; reportPeriod: ReportPeriod; from: string; to: string; marketplaceTimeZone: string; asins: string[]; brandEligibilityAttested: boolean };
export type BuyBoxHistoryPolicy = CommonPolicy & { allAsins?: true; resource: "buy_box_history"; from: string; to: string; marketplaceTimeZone: string; asins: string[] };
export type ProductDiscovery = { mode: "catalog_snapshot"; sourceId: string; maxObjects: number; batchSize: 100 };
type ProductOptions = { discovery?: ProductDiscovery; accessEvidence?: string };
export type ListingDetailPolicy = CommonPolicy & ProductOptions & { resource: "listing_details"; sellerSkus: string[] };
export type CatalogDetailPolicy = CommonPolicy & ProductOptions & { resource: "catalog_items"; asins: string[] };
export type NotificationPolicy = CommonPolicy & { resource: "notifications"; notificationTypes: string[] };
export type ObservationPolicy = NotificationPolicy | ListingDetailPolicy | CatalogDetailPolicy | InboundPolicy | PricingPolicy | AnalyticsPolicy | BuyBoxHistoryPolicy;
export const isObservationResource = (value: string): value is ObservationResource => (observationResources as readonly string[]).includes(value);
export function observationInvalid(message = "数据域策略、响应或范围校验失败；未发布新版本。"): never { throw new SyncInputError(message, 422); }
export function observationObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : observationInvalid(); }
export function observationText(value: unknown, max = 500): string { return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : observationInvalid(); }
function list(value: unknown, pattern: RegExp, max: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > max || value.some(v => typeof v !== "string" || !pattern.test(v)) || new Set(value).size !== value.length) return observationInvalid();
  return [...value].sort();
}
export function observationDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return observationInvalid();
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : observationInvalid();
}
export function parseObservationPolicy(value: unknown, resource?: string): ObservationPolicy {
  const p = observationObject(value);
  if (typeof p.resource !== "string" || !isObservationResource(p.resource) || resource !== undefined && p.resource !== resource) return observationInvalid();
  const applicationId = observationText(p.applicationId, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(applicationId)) return observationInvalid();
  const integer = (value: unknown, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max ? value : observationInvalid();
  const rate = p.requestsPerSecond;
  const ceiling = ["listing_details", "catalog_items", "notifications"].includes(p.resource) ? 1 : p.resource === "fulfillment" ? .5 : p.resource === "pricing" ? .03 : .0167;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > ceiling) return observationInvalid();
  const base: CommonPolicy = { resource: p.resource, applicationId, maxRequests: integer(p.maxRequests, 1000), maxRows: integer(p.maxRows, 50_000), requestsPerSecond: rate };
  if (p.resource === "notifications") {
    const types = list(p.notificationTypes, /^[A-Z][A-Z0-9_]{1,100}$/, 100);
    if (types.some(type => !(notificationTypes as readonly string[]).includes(type))) return observationInvalid();
    return { ...base, resource: "notifications", notificationTypes: types };
  }
  if (p.resource === "fulfillment") {
    if (p.discoverPlans !== undefined && p.discoverPlans !== true) return observationInvalid();
    const planIds = list(p.planIds, /^[A-Za-z0-9-]{38}$/, 100, p.discoverPlans === true);
    if (p.discoverPlans === true && planIds.length) return observationInvalid();
    return { ...base, resource: p.resource, planIds, ...(p.discoverPlans === true ? { discoverPlans: true } : {}) };
  }
  if (p.resource === "listing_details" || p.resource === "catalog_items" || p.resource === "pricing") {
    const extra: ProductOptions = {};
    if (p.discovery !== undefined) {
      const d = observationObject(p.discovery);
      if (d.mode !== "catalog_snapshot" || d.batchSize !== 100 || base.requestsPerSecond > .2 || base.maxRequests > 500) return observationInvalid();
      extra.discovery = { mode: "catalog_snapshot", sourceId: observationText(d.sourceId, 200), maxObjects: integer(d.maxObjects, 1000), batchSize: 100 };
    }
    if (p.accessEvidence !== undefined) extra.accessEvidence = observationText(p.accessEvidence, 6000);
    const ids = p.resource === "listing_details" ? list(p.sellerSkus, /^[^\u0000-\u001f\u007f]{1,255}$/, 100, !!extra.discovery) : list(p.asins, /^[A-Z0-9]{10}$/, p.resource === "pricing" ? 20 : 100, !!extra.discovery);
    if (extra.discovery && ids.length) return observationInvalid("自动发现不能同时配置静态对象。");
    return p.resource === "listing_details" ? { ...base, ...extra, resource: p.resource, sellerSkus: ids } : p.resource === "pricing" ? { ...base, ...extra, resource: p.resource, asins: ids } : { ...base, ...extra, resource: p.resource, asins: ids };
  }
  const asins = list(p.asins, /^[A-Z0-9]{10}$/, 18, p.resource === "buy_box_history" && p.allAsins === true || p.resource === "brand_analytics" && ["search_terms", "market_basket", "repeat_purchase"].includes(String(p.reportKind)));
  const from = observationDate(p.from), to = observationDate(p.to), marketplaceTimeZone = observationText(p.marketplaceTimeZone, 100);
  try { new Intl.DateTimeFormat("en-CA", { timeZone: marketplaceTimeZone }).format(); } catch { return observationInvalid(); }
  if (from > to) return observationInvalid();
  if (p.resource === "buy_box_history") {
    if (from !== to) return observationInvalid("ASIN Buy Box 历史任务仅允许单个已闭合业务日，避免伪造逐日分拆。");
    if (p.allAsins !== undefined && p.allAsins !== true || p.allAsins === true && asins.length) return observationInvalid();
    return { ...base, resource: p.resource, asins, from, to, marketplaceTimeZone, ...(p.allAsins === true ? { allAsins: true } : {}) };
  }
  if (typeof p.reportKind !== "string" || !Object.hasOwn(brandReportTypes, p.reportKind) || !["DAY", "WEEK", "MONTH", "QUARTER"].includes(String(p.reportPeriod))) return observationInvalid();
  const reportKind = p.reportKind as BrandReportKind, reportPeriod = p.reportPeriod as ReportPeriod;
  if (["search_query", "search_catalog", "repeat_purchase"].includes(reportKind) && reportPeriod === "DAY") return observationInvalid();
  if (["search_terms", "market_basket", "repeat_purchase"].includes(reportKind) && asins.length) return observationInvalid("该报告不接受 ASIN 请求过滤，不能伪装成指定商品覆盖。");
  const start = new Date(from + "T00:00:00Z"); let end = new Date(start);
  if (reportPeriod === "WEEK") { if (start.getUTCDay() !== 0) return observationInvalid(); end = new Date(start.getTime() + 6 * 86400000); }
  if (reportPeriod === "MONTH") { if (start.getUTCDate() !== 1) return observationInvalid(); end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)); }
  if (reportPeriod === "QUARTER") { if (start.getUTCDate() !== 1 || start.getUTCMonth() % 3) return observationInvalid(); end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0)); }
  if (end.toISOString().slice(0, 10) !== to) return observationInvalid("必须选择一个完整报告周期；不支持跨周期任务。");
  if (p.automaticDiscovery !== undefined && p.automaticDiscovery !== true || p.automaticDiscovery === true && p.collection !== undefined) return observationInvalid();
  return { ...base, resource: p.resource, reportKind, reportPeriod, asins, from, to, marketplaceTimeZone, brandEligibilityAttested: p.brandEligibilityAttested === true, ...(p.automaticDiscovery === true ? { automaticDiscovery: true } : {}), ...(p.collection === undefined ? {} : { collection: parseBrandCollection(p.collection) }) };
}
export function assertObservationRoles(policy: ObservationPolicy, auth: { approvedRoles: readonly string[]; rolesAttestedAt: Date | null }, context?: Omit<ProductAccessContext, "resource"> & { currentEvidence?: string }): void {
  if ((policy.resource === "listing_details" || policy.resource === "catalog_items") && context && (context.currentEvidence || policy.accessEvidence)) { assertProductAccessEvidence(context.currentEvidence ?? policy.accessEvidence!, { ...context, resource: policy.resource }); return; }
  // Account RBAC and source/identity checks are enforced by callers; Amazon enforces API roles.
  void auth;
}
export function assertObservationClosed(policy: ObservationPolicy, now = new Date(), marketplaceId?: string): void {
  if (policy.resource !== "brand_analytics" && policy.resource !== "buy_box_history") return;
  if (marketplaceId && policy.marketplaceTimeZone !== reportTimeZone(marketplaceId)) throw new SyncInputError("报告业务时区与站点不匹配。", 422);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: policy.marketplaceTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if ((policy.resource === "brand_analytics" && policy.collection ? policy.collection.to : policy.to) >= today) throw new SyncInputError("报告周期尚未闭合，不能启动任务。", 409);
}
export function observationReportSpec(policy: AnalyticsPolicy | BuyBoxHistoryPolicy, marketplaceId: string): { reportType: string; marketplaceIds: string[]; dataStartTime: string; dataEndTime: string; reportOptions: Record<string, string> } {
  return { reportType: policy.resource === "brand_analytics" ? brandReportTypes[policy.reportKind] : "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [marketplaceId], dataStartTime: policy.from, dataEndTime: policy.to,
    reportOptions: policy.resource === "buy_box_history" ? { dateGranularity: "DAY", asinGranularity: "CHILD" } : { reportPeriod: policy.reportPeriod, ...(policy.reportKind === "search_query" ? { asin: policy.asins.join(" ") } : policy.reportKind === "search_catalog" ? { asins: policy.asins.join(" ") } : {}) } };
}
