import type { AutomaticTaskPlanner } from "./automatic-planner-contract";
import { salesTrafficDayWindows, inventoryEventDayWindows, reimbursementDayWindows, type AutomaticDayWindowPolicy } from "./automatic-day-windows";
import { planBrandAnalytics, planBuyBoxHistory, planOrders, planFinance, planReturns, planSalesTraffic, planInventoryEvents, planRemovalOrders, planFbaShipments, planMfnReturns, planLongTermStorageFees, planSettlements, planReimbursements, planSnapshot, planObservation } from "./automatic-plan-strategies";
import { promotionsContract } from "./promotions";
import { SyncInputError } from "./policy";
import { latestClosedBrandWindow } from "./automatic-brand";
import { notificationTypes } from "./notification-types";
import { localDate, shiftDate } from "./date-range";
import { newFinanceRetentionStart, parseFinancePolicy } from "./finance";
import { parseOrderSyncPolicy } from "./orders";
import { parseObservationPolicy } from "./observation-policy";
import { parseReturnPolicy, returnReportTypes } from "./returns";
import { fbaInventoryByCountryMarketplaceIds } from "./inventory-report-contracts";

export type AutomaticExecutionKind = "catalog" | "inventory" | "orders" | "finance" | "returns" | "domain_report" | "report" | "observation";
export type AutomaticSourcePolicyBundle = {
  orderPolicy?: unknown;
  financePolicy?: unknown;
  returnsPolicy?: unknown;
  domainPolicy?: unknown;
  coverage?: unknown;
};
export type AutomaticRequiredPolicy = keyof AutomaticSourcePolicyBundle;
export type MarketplacePolicyContext = { now: Date; initialFrom: string; applicationId: string; marketplaceId: string; marketplaceTimeZone: string; catalogSourceId?: string };
export type SellerPolicyContext = { now: Date; initialFrom: string; applicationId: string; marketplaces: Array<{ marketplaceId: string; marketplaceTimeZone: string }> };
type AutomaticAdapterDefinition = {
  discoveryScope: "marketplace" | "seller";
  contract?: typeof promotionsContract;
  scheduleMode: "snapshot" | "incremental" | "date_range";
  publicationMode: "snapshot" | "window";
  intervalMinutes: number;
  freshnessMinutes?: number;
  /** Revisit a completed terminal window at the declared schedule cadence. */
  refreshCompletedWindow?: boolean;
  requiresVerifiedSeller: boolean;
  requiredAnyRoles?: readonly string[];
  supportedMarketplaceIds?: readonly string[];
  requiresMarketplaceCatalogSource?: boolean;
  executionKind: AutomaticExecutionKind;
  plannerKind: string;
  planTask: AutomaticTaskPlanner;
  createMarketplacePolicy?: (context: MarketplacePolicyContext) => AutomaticSourcePolicyBundle;
  createSellerPolicy?: (context: SellerPolicyContext) => AutomaticSourcePolicyBundle;
  scheduleInitialFrom?: (source: AutomaticSourcePolicyBundle, fallback: string) => string;
  prepareSchedulePolicy?: (source: AutomaticSourcePolicyBundle, defaultInitialFrom: string) => AutomaticSourcePolicyBundle;
  scheduleReady?: (source: AutomaticSourcePolicyBundle) => boolean;
  dayWindows?: AutomaticDayWindowPolicy;
} & ({ requiredPolicy: AutomaticRequiredPolicy; validatePolicy: (value: unknown) => unknown } | { requiredPolicy?: never; validatePolicy?: never });

const observationValidator = (resource: Parameters<typeof parseObservationPolicy>[1]) => (value: unknown) => parseObservationPolicy(value, resource);

const orderPolicy = (context: MarketplacePolicyContext) => ({ orderPolicy: parseOrderSyncPolicy({
  initialFrom: context.initialFrom, applicationId: context.applicationId, marketplaceTimeZone: context.marketplaceTimeZone,
  windowMinutes: 1440, overlapSeconds: 60, safetyLagSeconds: 180, requiredRoles: ["Inventory and Order Tracking"],
  requestsPerSecond: .0056, burst: 1, statusMapping: {},
  details: { includedData: [], requiredRoles: [], purpose: "operations_order_items", requestsPerSecond: .2, burst: 1, maxOrders: 5000, backfillExisting: true },
}) });
const returnPolicy = (context: MarketplacePolicyContext) => ({ returnsPolicy: parseReturnPolicy({
  initialFrom: context.initialFrom, applicationId: context.applicationId, marketplaceTimeZone: context.marketplaceTimeZone,
  windowMinutes: 43200, overlapSeconds: 60, safetyLagSeconds: 86400, reportType: returnReportTypes.FBA_RECEIVED,
  batchSize: 250, maxRows: 50000, pollMaxAttempts: 60, pollDeadlineMinutes: 1440, pollBaseSeconds: 60, pollMaxSeconds: 600,
  budgets: { createReport: { requestsPerSecond: .01, burst: 1 }, getReport: { requestsPerSecond: 1, burst: 1 }, getReportDocument: { requestsPerSecond: .01, burst: 1 } },
}) });
const brandPolicy = (context: MarketplacePolicyContext): AutomaticSourcePolicyBundle => {
  const window = latestClosedBrandWindow(localDate(context.now, context.marketplaceTimeZone), "QUARTER");
  return { domainPolicy: parseObservationPolicy({ resource: "brand_analytics", applicationId: context.applicationId, requestsPerSecond: .01, maxRequests: 500, maxRows: 50000,
    asins: [], automaticDiscovery: true, reportKind: "search_terms", reportPeriod: "DAY", from: window.from, to: window.from,
    marketplaceTimeZone: context.marketplaceTimeZone, brandEligibilityAttested: false }) };
};
const buyBoxPolicy = (context: MarketplacePolicyContext): AutomaticSourcePolicyBundle => {
  const firstDay = shiftDate(localDate(context.now, context.marketplaceTimeZone), -730);
  return { domainPolicy: parseObservationPolicy({ resource: "buy_box_history", applicationId: context.applicationId, requestsPerSecond: .01, maxRequests: 500, maxRows: 50000,
    asins: [], allAsins: true, from: firstDay, to: firstDay, marketplaceTimeZone: context.marketplaceTimeZone }) };
};
const fulfillmentPolicy = (context: MarketplacePolicyContext): AutomaticSourcePolicyBundle => ({
  domainPolicy: parseObservationPolicy({ resource: "fulfillment", applicationId: context.applicationId, requestsPerSecond: .2, maxRequests: 1000, maxRows: 50000, planIds: [], discoverPlans: true }),
});
const productPolicy = (resource: "listing_details" | "catalog_items" | "pricing", requestsPerSecond: number, maxObjects: number) => (context: MarketplacePolicyContext): AutomaticSourcePolicyBundle => {
  if (!context.catalogSourceId) return {};
  return { domainPolicy: parseObservationPolicy({ resource, applicationId: context.applicationId, requestsPerSecond, maxRequests: 500, maxRows: 50000,
    discovery: { mode: "catalog_snapshot", sourceId: context.catalogSourceId, maxObjects, batchSize: 100 }, ...(resource === "listing_details" ? { sellerSkus: [] } : { asins: [] }) }, resource) };
};
const financePolicy = (context: SellerPolicyContext): AutomaticSourcePolicyBundle => {
  const start = newFinanceRetentionStart(context.initialFrom, context.now);
  const policy = parseFinancePolicy({ initialFrom: start.initialFrom, applicationId: context.applicationId, windowMinutes: 43200, overlapSeconds: 60,
    safetyLagSeconds: 180, requestsPerSecond: .5, burst: 1, sellerWide: true, collectUnattributed: true, marketplaces: context.marketplaces });
  return { financePolicy: policy, ...(start.retentionGap ? { coverage: { retentionGaps: [start.retentionGap], historicalComplete: false } } : {}) };
};
const notificationsPolicy = (context: SellerPolicyContext): AutomaticSourcePolicyBundle => ({
  domainPolicy: parseObservationPolicy({ resource: "notifications", applicationId: context.applicationId, notificationTypes: [...notificationTypes], maxRequests: 500, maxRows: 50000, requestsPerSecond: .2 }),
});

/** Registration point shared by authorization discovery and automatic scheduling. */
export const automaticAdapters = [
  { resource: "fba_inventory_by_country", supportedMarketplaceIds: fbaInventoryByCountryMarketplaceIds, publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, freshnessMinutes: 180, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "fba_customer_sales", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "mfn_returns", publicationMode: "window", refreshCompletedWindow: true, discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Inventory and Order Tracking", "Direct to Consumer Shipping (Restricted)"], executionKind: "domain_report", plannerKind: "mfn_returns", planTask: planMfnReturns },
  { resource: "removal_order_report", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "removal_orders", planTask: planRemovalOrders },
  { resource: "removal_shipment_report", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "removal_orders", planTask: planRemovalOrders },
  { resource: "fba_shipments", publicationMode: "window", refreshCompletedWindow: true, discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment", "Inventory and Order Tracking"], executionKind: "domain_report", plannerKind: "fba_shipments", planTask: planFbaShipments },
  { resource: "storage_fees", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "recommended_removals", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "fba_overage_fees", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "fee_preview", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 4320, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "long_term_storage_fees", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, freshnessMinutes: 2880, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", refreshCompletedWindow: true, plannerKind: "long_term_storage_fees", planTask: planLongTermStorageFees },
  { resource: "fba_fulfilled_inventory", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, freshnessMinutes: 180, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "fba_inventory_report", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, freshnessMinutes: 180, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "reserved_inventory", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, freshnessMinutes: 180, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "stranded_inventory", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, freshnessMinutes: 180, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Amazon Fulfillment"], executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },

  { resource: "promotions", contract: promotionsContract, publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 360, requiresVerifiedSeller: true, requiredAnyRoles: ["Pricing", "Product Listing"], executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("promotions"), createMarketplacePolicy: (context: MarketplacePolicyContext) => ({ domainPolicy: parseObservationPolicy({ resource: "promotions", applicationId: context.applicationId, requestsPerSecond: .1, maxRequests: 1000, maxRows: 50000 }) }) },
  { resource: "catalog", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "catalog", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "inventory", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 60, freshnessMinutes: 360, requiresVerifiedSeller: false, executionKind: "inventory", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "orders", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 60, requiresVerifiedSeller: false, executionKind: "orders", plannerKind: "orders", planTask: planOrders, requiredPolicy: "orderPolicy", validatePolicy: parseOrderSyncPolicy, createMarketplacePolicy: orderPolicy,
    prepareSchedulePolicy: (source, initialFrom) => ({ orderPolicy: { ...parseOrderSyncPolicy(source.orderPolicy), initialFrom, windowMinutes: 1440 } }) },
  { resource: "sales_traffic", dayWindows: salesTrafficDayWindows, publicationMode: "window", refreshCompletedWindow: true, discoveryScope: "marketplace", scheduleMode: "date_range", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "report", plannerKind: "sales_traffic", planTask: planSalesTraffic },
  { resource: "finance", publicationMode: "window", discoveryScope: "seller", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "finance", plannerKind: "finance", planTask: planFinance, requiredPolicy: "financePolicy", validatePolicy: parseFinancePolicy, createSellerPolicy: financePolicy,
    scheduleInitialFrom: (source, fallback) => source.financePolicy ? parseFinancePolicy(source.financePolicy).initialFrom : fallback,
    prepareSchedulePolicy: source => source.financePolicy ? { financePolicy: { ...parseFinancePolicy(source.financePolicy), windowMinutes: 43200 } } : {} },
  { resource: "returns", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "returns", plannerKind: "returns", planTask: planReturns, requiredPolicy: "returnsPolicy", validatePolicy: parseReturnPolicy, createMarketplacePolicy: returnPolicy,
    prepareSchedulePolicy: (source, initialFrom) => ({ returnsPolicy: { ...parseReturnPolicy(source.returnsPolicy), initialFrom, windowMinutes: 43200 } }) },
  { resource: "settlements", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "domain_report", plannerKind: "settlements", planTask: planSettlements },
  { resource: "reimbursements", dayWindows: reimbursementDayWindows, publicationMode: "window", refreshCompletedWindow: true, discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "domain_report", plannerKind: "reimbursements", planTask: planReimbursements },
  { resource: "inventory_age", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "domain_report", plannerKind: "snapshot", planTask: planSnapshot },
  { resource: "inventory_events", dayWindows: inventoryEventDayWindows, publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "incremental", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "domain_report", plannerKind: "inventory_events", planTask: planInventoryEvents },
  { resource: "fulfillment", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 120, requiresVerifiedSeller: false, executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("fulfillment"), createMarketplacePolicy: fulfillmentPolicy },
  { resource: "listing_details", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: true, requiresMarketplaceCatalogSource: true, executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("listing_details"), createMarketplacePolicy: productPolicy("listing_details", .2, 500) },
  { resource: "catalog_items", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: true, requiresMarketplaceCatalogSource: true, executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("catalog_items"), createMarketplacePolicy: productPolicy("catalog_items", .2, 500) },
  { resource: "pricing", publicationMode: "snapshot", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 60, requiresVerifiedSeller: true, requiresMarketplaceCatalogSource: true, executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("pricing"), createMarketplacePolicy: productPolicy("pricing", .03, 1000) },
  { resource: "brand_analytics", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "observation", plannerKind: "brand_analytics", planTask: planBrandAnalytics, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("brand_analytics"), createMarketplacePolicy: brandPolicy,
    scheduleReady: source => { const policy = parseObservationPolicy(source.domainPolicy, "brand_analytics"); return policy.resource === "brand_analytics" && !!(policy.collection || policy.automaticDiscovery); } },
  { resource: "buy_box_history", publicationMode: "window", discoveryScope: "marketplace", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "observation", plannerKind: "buy_box_history", planTask: planBuyBoxHistory, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("buy_box_history"), createMarketplacePolicy: buyBoxPolicy },
  { resource: "notifications", publicationMode: "snapshot", discoveryScope: "seller", scheduleMode: "snapshot", intervalMinutes: 1440, requiresVerifiedSeller: false, executionKind: "observation", plannerKind: "observation", planTask: planObservation, requiredPolicy: "domainPolicy", validatePolicy: observationValidator("notifications"), createSellerPolicy: notificationsPolicy },
] as const satisfies readonly (AutomaticAdapterDefinition & { resource: string })[];

export type AutomaticAdapterResource = typeof automaticAdapters[number]["resource"];
export type AutomaticAdapter = AutomaticAdapterDefinition & { resource: AutomaticAdapterResource };
export const automaticAdapterResources = automaticAdapters.map(adapter => adapter.resource);
export const marketplaceAutomaticAdapters: AutomaticAdapter[] = automaticAdapters.filter(adapter => adapter.discoveryScope === "marketplace");
export const sellerAutomaticAdapters: AutomaticAdapter[] = automaticAdapters.filter(adapter => adapter.discoveryScope === "seller");

export function automaticAdapter(resource: string): AutomaticAdapter | undefined {
  return automaticAdapters.find(adapter => adapter.resource === resource);
}

export function automaticSourcePolicyFields(bundle: AutomaticSourcePolicyBundle) {
  return {
    ...(bundle.orderPolicy !== undefined ? { orderPolicy: bundle.orderPolicy } : {}),
    ...(bundle.financePolicy !== undefined ? { financePolicy: bundle.financePolicy } : {}),
    ...(bundle.returnsPolicy !== undefined ? { returnsPolicy: bundle.returnsPolicy } : {}),
    ...(bundle.domainPolicy !== undefined ? { domainPolicy: bundle.domainPolicy } : {}),
    ...(bundle.coverage !== undefined ? { coverage: bundle.coverage } : {}),
  };
}

export function automaticAdapterHasRequiredPolicy(adapter: AutomaticAdapter, source: AutomaticSourcePolicyBundle) {
  return !adapter.requiredPolicy || source[adapter.requiredPolicy] !== undefined && source[adapter.requiredPolicy] !== null;
}

export function automaticAdapterHasRequiredRoles(adapter: AutomaticAdapter, rolesAttested: boolean, roles: readonly string[]) {
  return !adapter.requiredAnyRoles?.length || rolesAttested && adapter.requiredAnyRoles.some(role => roles.includes(role));
}

export function automaticAdapterFreshnessMinutes(adapter: AutomaticAdapter) {
  return adapter.freshnessMinutes ?? 2880;
}

/** Use the same policy parser as execution; validation never rewrites input. */
export function assertAutomaticAdapterPolicy(adapter: AutomaticAdapter, source: AutomaticSourcePolicyBundle) {
  if (!adapter.requiredPolicy) return;
  if (!automaticAdapterHasRequiredPolicy(adapter, source)) throw new SyncInputError("自动同步适配器缺少必要策略。", 422);
  adapter.validatePolicy(source[adapter.requiredPolicy]);
}
