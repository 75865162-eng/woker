import { parseNotificationSubscriptions } from "./notifications";
import { brandReportTypes } from "./observation-policy";
import { parseProductDetail } from "./product-observations";
import { assertInboundPageProgress, assertInboundPlanMarketplace, inboundItemKey, parseInboundItemsPage, parseInboundPlan, parseInboundShipment, parseInboundPlansPage } from "./inbound";
import { observationFact, parseOwnPrices, parseCompetitivePrices, parseObservationReport, type SafeFact } from "./observation-parsers";
import { observationInvalid as invalid, observationObject as object, observationText as text, type NotificationPolicy, type ObservationPolicy } from "./observation-policy";

export type NotificationPage = { index: number; token?: string; priorTokens: string[] };
export type ObservationState = { version: 1; stage: "SUBSCRIPTIONS" | "DISCOVER_PLANS" | "PRODUCT_DETAIL" | "PLAN" | "PLAN_ITEMS" | "SHIPMENT" | "SHIPMENT_ITEMS" | "VERIFY_PLAN" | "PRICE" | "OWN_PRICE" | "CREATE" | "CREATING" | "POLL" | "DOCUMENT" | "DOWNLOAD" | "COMPLETE"; requests: number; planIndex: number; shipmentIndex: number; shipmentIds: string[]; discoveredPlanIds?: string[]; unavailableObjectIndexes?: number[]; unavailableNotificationTypes?: string[]; notificationFailures?: NotificationPage[]; notificationRetryQueue?: NotificationPage[]; planSignature?: string; token?: string; priorTokens: string[]; reportId?: string; documentId?: string; document?: Record<string, unknown> };
export function initialObservationState(policy: ObservationPolicy): ObservationState {
  return { version: 1, stage: policy.resource === "notifications" ? "SUBSCRIPTIONS" : ["listing_details", "catalog_items"].includes(policy.resource) ? "PRODUCT_DETAIL" : policy.resource === "fulfillment" ? policy.discoverPlans ? "DISCOVER_PLANS" : "PLAN" : policy.resource === "pricing" ? "PRICE" : "CREATE", requests: 0, planIndex: 0, shipmentIndex: 0, shipmentIds: [], priorTokens: [] };
}
export function observationOperation(state: ObservationState, resource?: string): string {
  const map: Record<ObservationState["stage"], string> = { SUBSCRIPTIONS: "getSubscriptions", DISCOVER_PLANS: "listInboundPlans", PRODUCT_DETAIL: resource === "listing_details" ? "getListingsItem" : "getCatalogItem", PLAN: "getInboundPlan", PLAN_ITEMS: "listInboundPlanItems", SHIPMENT: "getShipment", SHIPMENT_ITEMS: "listShipmentItems", VERIFY_PLAN: "getInboundPlan", PRICE: "getCompetitiveSummary", OWN_PRICE: "getPricing", CREATE: "createReport", CREATING: "uncertainCreate", POLL: "getReport", DOCUMENT: "getReportDocument", DOWNLOAD: "downloadReportDocument", COMPLETE: "publish" };
  return map[state.stage];
}
/** State is authenticated/encrypted by the processor. Validate again before use. */
export function parseObservationState(value: unknown, policy: ObservationPolicy): ObservationState {
  if (!value) return initialObservationState(policy);
  const s = object(value);
  if (s.version !== 1 || !["SUBSCRIPTIONS", "DISCOVER_PLANS", "PRODUCT_DETAIL", "PLAN", "PLAN_ITEMS", "SHIPMENT", "SHIPMENT_ITEMS", "VERIFY_PLAN", "PRICE", "OWN_PRICE", "CREATE", "CREATING", "POLL", "DOCUMENT", "DOWNLOAD", "COMPLETE"].includes(String(s.stage))) return invalid();
  for (const key of ["requests", "planIndex", "shipmentIndex"]) if (!Number.isSafeInteger(s[key]) || Number(s[key]) < 0) return invalid();
  if (!Array.isArray(s.shipmentIds) || s.shipmentIds.length > 1000 || !Array.isArray(s.priorTokens) || s.priorTokens.length > 1000 || s.shipmentIds.some(v => typeof v !== "string") || s.priorTokens.some(v => typeof v !== "string") || Number(s.requests) > policy.maxRequests) return invalid();
  if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
    const count = policy.resource === "listing_details" ? policy.sellerSkus.length : policy.asins.length;
    if (!["PRODUCT_DETAIL", "COMPLETE"].includes(String(s.stage)) || Number(s.planIndex) > count || (s.stage === "COMPLETE") !== (s.planIndex === count)) return invalid();
  }
  if (policy.resource === "notifications") {
    if (!["SUBSCRIPTIONS", "COMPLETE"].includes(String(s.stage)) || Number(s.planIndex) > policy.notificationTypes.length || (s.stage === "COMPLETE") !== (s.planIndex === policy.notificationTypes.length)) return invalid();
    if (s.unavailableNotificationTypes !== undefined && (!Array.isArray(s.unavailableNotificationTypes) || new Set(s.unavailableNotificationTypes).size !== s.unavailableNotificationTypes.length || s.unavailableNotificationTypes.some(type => typeof type !== "string" || !policy.notificationTypes.slice(0, Number(s.planIndex)).includes(type)))) return invalid();
    for (const key of ["notificationFailures", "notificationRetryQueue"]) if (s[key] !== undefined) {
      const pages = s[key];
      if (!Array.isArray(pages) || pages.length > policy.notificationTypes.length) return invalid();
      const indexes = new Set<number>();
      for (const value of pages) {
        const page = object(value), index = Number(page.index);
        if (!Number.isSafeInteger(page.index) || index < 0 || index >= policy.notificationTypes.length || indexes.has(index) || page.token !== undefined && (typeof page.token !== "string" || page.token.length > 32000) || !Array.isArray(page.priorTokens) || page.priorTokens.length > 1000 || page.priorTokens.some(token => typeof token !== "string" || token.length > 32000)) return invalid();
        indexes.add(index);
      }
    }
  } else if (s.unavailableNotificationTypes !== undefined || s.notificationFailures !== undefined || s.notificationRetryQueue !== undefined) return invalid();
  if (s.discoveredPlanIds !== undefined && (!Array.isArray(s.discoveredPlanIds) || s.discoveredPlanIds.length > 100 || s.discoveredPlanIds.some(v => typeof v !== "string" || !/^[A-Za-z0-9-]{38}$/.test(v)) || new Set(s.discoveredPlanIds).size !== s.discoveredPlanIds.length)) return invalid();
  if (s.unavailableObjectIndexes !== undefined && (!Array.isArray(s.unavailableObjectIndexes) || !["listing_details", "catalog_items"].includes(policy.resource) || s.unavailableObjectIndexes.some(v => !Number.isSafeInteger(v) || Number(v) < 0 || Number(v) >= Number(s.planIndex)) || new Set(s.unavailableObjectIndexes).size !== s.unavailableObjectIndexes.length)) return invalid();
  return s as unknown as ObservationState;
}
/** Advance only unfinished types during an approved retry; successful pages stay committed. */
export function completeNotificationType(s: ObservationState, policy: NotificationPolicy): void {
  if (s.notificationRetryQueue) {
    s.notificationRetryQueue.shift();
    const next = s.notificationRetryQueue[0];
    s.planIndex = next?.index ?? policy.notificationTypes.length;
    s.token = next?.token; s.priorTokens = next ? [...next.priorTokens] : [];
  } else { s.planIndex++; delete s.token; s.priorTokens = []; }
  if (s.planIndex === policy.notificationTypes.length) s.stage = "COMPLETE";
}

export function retryNotificationFailures(s: ObservationState, policy: NotificationPolicy): ObservationState {
  if (s.stage !== "COMPLETE" || !s.notificationFailures?.length) return invalid();
  const next = structuredClone(s), pages = next.notificationFailures!;
  next.notificationRetryQueue = pages; next.notificationFailures = []; next.unavailableNotificationTypes = [];
  next.planIndex = pages[0].index; next.token = pages[0].token; next.priorTokens = [...pages[0].priorTokens]; next.stage = "SUBSCRIPTIONS";
  return parseObservationState(next, policy);
}

function signature(value: unknown): string { return JSON.stringify(value); }
/** One response, one transition. No network, database, credentials or clock here. */
export function advanceObservation(policy: ObservationPolicy, state: ObservationState, response: unknown, context: { marketplaceId: string; sellerId: string; rawBody: string }): { state: ObservationState; rows: SafeFact[] } {
  const s = structuredClone(state); let rows: SafeFact[] = [];
  if (policy.resource === "notifications") {
    if (s.stage !== "SUBSCRIPTIONS") return invalid();
    const page = parseNotificationSubscriptions(response, policy.notificationTypes[s.planIndex]);
    assertInboundPageProgress(s.token, page.nextToken, s.priorTokens);
    rows = page.rows;
    if (s.token) s.priorTokens.push(s.token);
    s.token = page.nextToken;
    if (!page.nextToken) completeNotificationType(s, policy);
  } else if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
    const ids = policy.resource === "listing_details" ? policy.sellerSkus : policy.asins;
    if (s.stage !== "PRODUCT_DETAIL" || s.planIndex >= ids.length) return invalid();
    rows = [parseProductDetail(context.rawBody, policy, s.planIndex, context.marketplaceId)];
    s.planIndex++; if (s.planIndex === ids.length) s.stage = "COMPLETE";
  } else if (policy.resource === "fulfillment") {
    if (s.stage === "DISCOVER_PLANS") {
      if (!policy.discoverPlans) return invalid();
      const page = parseInboundPlansPage(response);
      assertInboundPageProgress(s.token, page.nextToken, s.priorTokens);
      const ids = new Set(s.discoveredPlanIds ?? []);
      for (const plan of page.plans) if (plan.marketplaceIds.includes(context.marketplaceId)) ids.add(plan.inboundPlanId);
      if (ids.size > 100 || [...ids].some(id => !/^[A-Za-z0-9-]{38}$/.test(id))) return invalid();
      s.discoveredPlanIds = [...ids];
      if (s.token) s.priorTokens.push(s.token);
      s.token = page.nextToken;
      if (!page.nextToken) { s.priorTokens = []; s.stage = ids.size ? "PLAN" : "COMPLETE"; }
      return { state: s, rows };
    }
    const planIds = policy.discoverPlans ? s.discoveredPlanIds ?? [] : policy.planIds;
    const inboundPlanId = planIds[s.planIndex]; if (!inboundPlanId) return invalid();
    const shipmentId = s.shipmentIds[s.shipmentIndex];
    if (s.stage === "PLAN" || s.stage === "VERIFY_PLAN") {
      const plan = parseInboundPlan(response, inboundPlanId); assertInboundPlanMarketplace(plan, context.marketplaceId);
      if (s.stage === "VERIFY_PLAN") {
        if (s.planSignature !== signature(plan)) return invalid();
        s.planIndex++; s.shipmentIds = []; s.priorTokens = []; delete s.planSignature; s.stage = s.planIndex === planIds.length ? "COMPLETE" : "PLAN";
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
    const batch = { ...policy, asins: policy.asins.slice(s.planIndex, s.planIndex + 20) };
    if (!batch.asins.length) return invalid();
    if (s.stage === "PRICE") { rows = parseCompetitivePrices(context.rawBody, batch, context.marketplaceId, context.sellerId); s.stage = "OWN_PRICE"; }
    else if (s.stage === "OWN_PRICE") { rows = parseOwnPrices(context.rawBody, batch, context.marketplaceId, context.sellerId); s.planIndex += batch.asins.length; s.stage = s.planIndex === policy.asins.length ? "COMPLETE" : "PRICE"; }
    else return invalid();
  } else {
    const root = s.stage === "DOWNLOAD" ? {} : object(response);
    if (s.stage === "CREATING") { s.reportId = text(root.reportId, 200); s.stage = "POLL"; }
    else if (s.stage === "POLL") {
      if (root.reportId !== s.reportId || root.reportType !== (policy.resource === "brand_analytics" ? brandReportTypes[policy.reportKind] : "GET_SALES_AND_TRAFFIC_REPORT") || !Array.isArray(root.marketplaceIds) || root.marketplaceIds.length !== 1 || root.marketplaceIds[0] !== context.marketplaceId) return invalid();
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
