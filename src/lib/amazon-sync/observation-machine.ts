import { parseProductDetail } from "./product-observations";
import { assertInboundPageProgress, assertInboundPlanMarketplace, inboundItemKey, parseInboundItemsPage, parseInboundPlan, parseInboundShipment } from "./inbound";
import { observationFact, parseOwnPrices, parseCompetitivePrices, parseObservationReport, type SafeFact } from "./observation-parsers";
import { observationInvalid as invalid, observationObject as object, observationText as text, type ObservationPolicy } from "./observation-policy";

export type ObservationState = { version: 1; stage: "PRODUCT_DETAIL" | "PLAN" | "PLAN_ITEMS" | "SHIPMENT" | "SHIPMENT_ITEMS" | "VERIFY_PLAN" | "PRICE" | "OWN_PRICE" | "CREATE" | "CREATING" | "POLL" | "DOCUMENT" | "DOWNLOAD" | "COMPLETE"; requests: number; planIndex: number; shipmentIndex: number; shipmentIds: string[]; planSignature?: string; token?: string; priorTokens: string[]; reportId?: string; documentId?: string; document?: Record<string, unknown> };
export function initialObservationState(policy: ObservationPolicy): ObservationState {
  return { version: 1, stage: ["listing_details", "catalog_items"].includes(policy.resource) ? "PRODUCT_DETAIL" : policy.resource === "fulfillment" ? "PLAN" : policy.resource === "pricing" ? "PRICE" : "CREATE", requests: 0, planIndex: 0, shipmentIndex: 0, shipmentIds: [], priorTokens: [] };
}
export function observationOperation(state: ObservationState, resource?: string): string {
  const map: Record<ObservationState["stage"], string> = { PRODUCT_DETAIL: resource === "listing_details" ? "getListingsItem" : "getCatalogItem", PLAN: "getInboundPlan", PLAN_ITEMS: "listInboundPlanItems", SHIPMENT: "getShipment", SHIPMENT_ITEMS: "listShipmentItems", VERIFY_PLAN: "getInboundPlan", PRICE: "getCompetitiveSummary", OWN_PRICE: "getPricing", CREATE: "createReport", CREATING: "uncertainCreate", POLL: "getReport", DOCUMENT: "getReportDocument", DOWNLOAD: "downloadReportDocument", COMPLETE: "publish" };
  return map[state.stage];
}
/** State is authenticated/encrypted by the processor. Validate again before use. */
export function parseObservationState(value: unknown, policy: ObservationPolicy): ObservationState {
  if (!value) return initialObservationState(policy);
  const s = object(value);
  if (s.version !== 1 || !["PRODUCT_DETAIL", "PLAN", "PLAN_ITEMS", "SHIPMENT", "SHIPMENT_ITEMS", "VERIFY_PLAN", "PRICE", "OWN_PRICE", "CREATE", "CREATING", "POLL", "DOCUMENT", "DOWNLOAD", "COMPLETE"].includes(String(s.stage))) return invalid();
  for (const key of ["requests", "planIndex", "shipmentIndex"]) if (!Number.isSafeInteger(s[key]) || Number(s[key]) < 0) return invalid();
  if (!Array.isArray(s.shipmentIds) || s.shipmentIds.length > 1000 || !Array.isArray(s.priorTokens) || s.priorTokens.length > 1000 || s.shipmentIds.some(v => typeof v !== "string") || s.priorTokens.some(v => typeof v !== "string") || Number(s.requests) > policy.maxRequests) return invalid();
  if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
    const count = policy.resource === "listing_details" ? policy.sellerSkus.length : policy.asins.length;
    if (!["PRODUCT_DETAIL", "COMPLETE"].includes(String(s.stage)) || Number(s.planIndex) > count || (s.stage === "COMPLETE") !== (s.planIndex === count)) return invalid();
  }
  return s as unknown as ObservationState;
}
function signature(value: unknown): string { return JSON.stringify(value); }
/** One response, one transition. No network, database, credentials or clock here. */
export function advanceObservation(policy: ObservationPolicy, state: ObservationState, response: unknown, context: { marketplaceId: string; sellerId: string; rawBody: string }): { state: ObservationState; rows: SafeFact[] } {
  const s = structuredClone(state); let rows: SafeFact[] = [];
  if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
    const ids = policy.resource === "listing_details" ? policy.sellerSkus : policy.asins;
    if (s.stage !== "PRODUCT_DETAIL" || s.planIndex >= ids.length) return invalid();
    rows = [parseProductDetail(context.rawBody, policy, s.planIndex, context.marketplaceId)];
    s.planIndex++; if (s.planIndex === ids.length) s.stage = "COMPLETE";
  } else if (policy.resource === "fulfillment") {
    const inboundPlanId = policy.planIds[s.planIndex]; if (!inboundPlanId) return invalid();
    const shipmentId = s.shipmentIds[s.shipmentIndex];
    if (s.stage === "PLAN" || s.stage === "VERIFY_PLAN") {
      const plan = parseInboundPlan(response, inboundPlanId); assertInboundPlanMarketplace(plan, context.marketplaceId);
      if (s.stage === "VERIFY_PLAN") {
        if (s.planSignature !== signature(plan)) return invalid();
        s.planIndex++; s.shipmentIds = []; s.priorTokens = []; delete s.planSignature; s.stage = s.planIndex === policy.planIds.length ? "COMPLETE" : "PLAN";
      } else {
        s.planSignature = signature(plan); s.shipmentIds = plan.shipments.map(v => v.shipmentId); s.shipmentIndex = 0; s.stage = "PLAN_ITEMS";
        const { shipments: _shipments, ...facts } = plan; void _shipments;
        rows = [observationFact("INBOUND_PLAN", inboundPlanId, facts)];
      }
    } else if (s.stage === "SHIPMENT") {
      const facts = parseInboundShipment(response, { inboundPlanId, shipmentId }); s.stage = "SHIPMENT_ITEMS";
      rows = [observationFact("INBOUND_SHIPMENT", [inboundPlanId, shipmentId], facts)];
    } else if (s.stage === "PLAN_ITEMS" || s.stage === "SHIPMENT_ITEMS") {
      const isPlan = s.stage === "PLAN_ITEMS", page = parseInboundItemsPage(response, { inboundPlanId, ...(isPlan ? {} : { shipmentId }) });
      assertInboundPageProgress(s.token, page.nextToken, s.priorTokens);
      rows = page.items.map(facts => observationFact(isPlan ? "INBOUND_PLAN_ITEM" : "INBOUND_SHIPMENT_ITEM", inboundItemKey(facts), facts, { asin: facts.asin, sellerSku: facts.sellerSku }));
      if (s.token) s.priorTokens.push(s.token); s.token = page.nextToken;
      if (!page.nextToken) {
        s.priorTokens = [];
        if (isPlan) s.stage = s.shipmentIds.length ? "SHIPMENT" : "VERIFY_PLAN";
        else { s.shipmentIndex++; s.stage = s.shipmentIndex < s.shipmentIds.length ? "SHIPMENT" : "VERIFY_PLAN"; }
      }
    } else return invalid();
  } else if (policy.resource === "pricing") {
    if (s.stage === "PRICE") { rows = parseCompetitivePrices(context.rawBody, policy, context.marketplaceId, context.sellerId); s.stage = "OWN_PRICE"; }
    else if (s.stage === "OWN_PRICE") { rows = parseOwnPrices(context.rawBody, policy, context.marketplaceId, context.sellerId); s.stage = "COMPLETE"; }
    else return invalid();
  } else {
    const root = s.stage === "DOWNLOAD" ? {} : object(response);
    if (s.stage === "CREATING") { s.reportId = text(root.reportId, 200); s.stage = "POLL"; }
    else if (s.stage === "POLL") {
      if (root.reportId !== s.reportId || root.reportType !== (policy.resource === "brand_analytics" ? { search_terms: "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT", search_query: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", search_catalog: "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT", market_basket: "GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT" }[policy.reportKind] : "GET_SALES_AND_TRAFFIC_REPORT") || !Array.isArray(root.marketplaceIds) || root.marketplaceIds.length !== 1 || root.marketplaceIds[0] !== context.marketplaceId) return invalid();
      if (root.processingStatus === "DONE") { s.documentId = text(root.reportDocumentId, 200); s.stage = "DOCUMENT"; }
      else if (!["IN_QUEUE", "IN_PROGRESS"].includes(String(root.processingStatus))) return invalid();
    } else if (s.stage === "DOCUMENT") {
      if (root.reportDocumentId !== s.documentId) return invalid();
      s.document = { reportDocumentId: s.documentId, url: text(root.url, 16000), ...(root.compressionAlgorithm ? { compressionAlgorithm: text(root.compressionAlgorithm, 30) } : {}) }; s.stage = "DOWNLOAD";
    } else if (s.stage === "DOWNLOAD") { rows = parseObservationReport(context.rawBody, policy, context.marketplaceId); delete s.document; s.stage = "COMPLETE"; }
    else return invalid();
  }
  return { state: s, rows };
}
