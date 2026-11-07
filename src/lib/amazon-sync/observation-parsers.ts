import repeatPurchase from "@/data/amazon-contracts/sellingPartnerRepeatPurchaseReport.json";
import { createHash } from "node:crypto";
import searchTerms from "@/data/amazon-contracts/sellingPartnerSearchTermsReport.json";
import searchQuery from "@/data/amazon-contracts/sellingPartnerSearchQueryPerformanceReport.json";
import searchCatalog from "@/data/amazon-contracts/sellingPartnerSearchCatalogPerformanceReport.json";
import marketBasket from "@/data/amazon-contracts/sellingPartnerMarketBasketAnalysisReport.json";
import salesTraffic from "@/data/amazon-contracts/sellerSalesAndTrafficReport.json";
import { readFinanceJson, WireDecimal } from "./finance";
import { observationDate, observationInvalid as invalid, observationObject as object, observationReportSpec, observationText as text, type AnalyticsPolicy, type BuyBoxHistoryPolicy, type PricingPolicy } from "./observation-policy";

export type SafeFact = { kind: string; businessKey: string; asin: string | null; sellerSku: string | null; searchTerm: string | null; facts: Record<string, unknown> };
export function observationFact(kind: string, identity: unknown, facts: Record<string, unknown>, columns: Partial<Pick<SafeFact, "asin" | "sellerSku" | "searchTerm">> = {}): SafeFact {
  return { kind, businessKey: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), asin: null, sellerSku: null, searchTerm: null, ...columns, facts };
}
export function deduplicateFacts(rows: SafeFact[], maxRows: number): SafeFact[] {
  const unique = new Map<string, SafeFact>();
  for (const row of rows) {
    const key = row.kind + row.businessKey, previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) return invalid();
    unique.set(key, row); if (unique.size > maxRows) return invalid();
  }
  return [...unique.values()];
}
const asin = (v: unknown) => typeof v === "string" && /^[A-Z0-9]{10}$/.test(v) ? v : invalid();
function array(v: unknown, max = 1000): unknown[] { return Array.isArray(v) && v.length <= max ? v : invalid(); }
function decimal(v: unknown, min = 0, max = Number.MAX_VALUE) {
  if (!(v instanceof WireDecimal) || !Number.isFinite(Number(v.source)) || Number(v.source) < min || Number(v.source) > max) return invalid();
  return v.source;
}
function money(v: unknown) { const row = object(v); return { amount: decimal(row.amount), currencyCode: /^[A-Z]{3}$/.test(text(row.currencyCode, 3)) ? row.currencyCode as string : invalid() }; }

/** Every segment stays explicit; own price is unknown unless the own offer is returned.
 * Decimal lexemes survive without a binary floating-point round trip.
 */
export function parseCompetitivePrices(raw: string, policy: PricingPolicy, marketplaceId: string, sellerId: string): SafeFact[] {
  const root = object(readFinanceJson(raw)), responses = array(root.responses, 20), seen = new Set<string>();
  const rows = responses.map(value => {
    const response = object(value), status = object(response.status);
    if (decimal(status.statusCode, 200, 200) !== "200") return invalid();
    const body = object(response.body), id = asin(body.asin);
    if (body.errors !== undefined && array(body.errors, 100).length) return invalid();
    if (body.marketplaceId !== marketplaceId || !policy.asins.includes(id) || seen.has(id)) return invalid(); seen.add(id);
    const featuredBuyingOptions = array(body.featuredBuyingOptions ?? [], 20).map(value => {
      const option = object(value);
      return { buyingOptionType: text(option.buyingOptionType, 50), segmentedFeaturedOffers: array(option.segmentedFeaturedOffers ?? [], 100).map(value => {
        const offer = object(value);
        return { sellerId: text(offer.sellerId, 100), isOwnOffer: offer.sellerId === sellerId, condition: text(offer.condition, 50), fulfillmentType: text(offer.fulfillmentType, 50), listingPrice: money(offer.listingPrice),
          shippingOptions: array(offer.shippingOptions ?? [], 100).map(v => { const shipping = object(v); return { shippingOptionType: text(shipping.shippingOptionType, 100), price: money(shipping.price) }; }),
          featuredOfferSegments: array(offer.featuredOfferSegments ?? [], 100).map(v => { const segment = object(v); const details = object(segment.segmentDetails);
            return { customerMembership: text(segment.customerMembership, 50), segmentDetails: { ...(details.glanceViewWeightPercentage === undefined ? {} : { glanceViewWeightPercentage: decimal(details.glanceViewWeightPercentage, 0, 100) }), ...(details.sampleLocation === undefined ? {} : { sampleLocation: { postalCode: text(object(details.sampleLocation).postalCode, 20) } }) } }; }) };
      }) };
    });
    const referencePrices = array(body.referencePrices ?? [], 50).map(v => { const row = object(v); return { name: text(row.name, 100), price: money(row.price) }; });
    return observationFact("COMPETITIVE_PRICE", id, { asin: id, marketplaceId, featuredBuyingOptions, referencePrices, ownPriceCoverage: "ONLY_IF_RETURNED_IN_FEATURED_SEGMENT", winnerMeaning: "SEGMENT_SPECIFIC_CURRENT_OBSERVATION" }, { asin: id });
  });
  if (seen.size !== policy.asins.length) return invalid();
  return rows;
}

type Schema = { $ref?: string; type?: string; required?: string[]; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[]; minimum?: number; maximum?: number; pattern?: string; format?: string; definitions?: Record<string, Schema> };
type Projected = string | boolean | null | Projected[] | { [key: string]: Projected };
/** Frozen official report schemas are also the field allowlist. Unknown fields are
 * discarded, never copied into public facts. All wire numbers become exact strings.
 */
function project(value: unknown, schema: Schema, root: Schema, depth = 0): Projected {
  if (depth > 32) return invalid();
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/definitions/")) return invalid();
    const resolved = root.definitions?.[schema.$ref.slice(14)];
    return resolved ? project(value, resolved, root, depth + 1) : invalid();
  }
  if (schema.type === "object") {
    const row = object(value), result: Record<string, Projected> = Object.create(null);
    for (const key of schema.required ?? []) if (row[key] === undefined) return invalid();
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (row[key] !== undefined) result[key] = project(row[key], child, root, depth + 1);
    return result;
  }
  if (schema.type === "array") return array(value, 50_000).map(row => project(row, schema.items ?? { type: "string" }, root, depth + 1));
  if (schema.type === "number" || schema.type === "integer") {
    const result = decimal(value, schema.minimum ?? 0, schema.maximum ?? Number.MAX_VALUE);
    if (schema.type === "integer" && !Number.isSafeInteger(Number(result))) return invalid();
    return result;
  }
  if (schema.type === "string") {
    const result = text(value, 5000);
    if (schema.enum && !schema.enum.includes(result) || schema.pattern && !new RegExp(schema.pattern).test(result)) return invalid();
    if (schema.format === "date") observationDate(result);
    return result;
  }
  return invalid();
}
const schemas = { search_terms: searchTerms, search_query: searchQuery, search_catalog: searchCatalog, market_basket: marketBasket, repeat_purchase: repeatPurchase };
export function parseObservationReport(raw: string, policy: AnalyticsPolicy | BuyBoxHistoryPolicy, marketplaceId: string): SafeFact[] {
  const schema = (policy.resource === "buy_box_history" ? salesTraffic : schemas[policy.reportKind]) as Schema;
  const projected = object(project(readFinanceJson(raw), schema, schema)), expected = observationReportSpec(policy, marketplaceId), spec = object(projected.reportSpecification);
  if (spec.reportType !== expected.reportType || spec.dataStartTime !== policy.from || spec.dataEndTime !== policy.to || JSON.stringify(spec.marketplaceIds) !== JSON.stringify([marketplaceId])) return invalid();
  const options = object(spec.reportOptions);
  for (const [key, value] of Object.entries(expected.reportOptions)) if (options[key] !== value) return invalid();
  const isTerms = policy.resource === "brand_analytics" && policy.reportKind === "search_terms";
  const data = array(projected[policy.resource === "buy_box_history" ? "salesAndTrafficByAsin" : isTerms ? "dataByDepartmentAndSearchTerm" : "dataByAsin"], policy.maxRows);
  const rows = data.map(v => {
    const row = object(v);
    if (policy.resource === "buy_box_history") {
      const id = asin(row.childAsin);
      if (!policy.asins.includes(id)) return null;
      const traffic = object(row.trafficByAsin);
      if (traffic.buyBoxPercentage !== undefined && (!Number.isFinite(Number(traffic.buyBoxPercentage)) || Number(traffic.buyBoxPercentage) < 0 || Number(traffic.buyBoxPercentage) > 100)) return invalid();
      return observationFact("BUY_BOX_DAY", [policy.from, id], { businessDate: policy.from, asin: id, buyBoxPercentage: traffic.buyBoxPercentage ?? null, sessions: traffic.sessions ?? null, pageViews: traffic.pageViews ?? null, unit: "PERCENT_0_100", meaning: "ONE_DAY_CHILD_ASIN_TRAFFIC_REPORT" }, { asin: id });
    }
    const validateShares = (value: unknown): void => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, v] of Object.entries(value)) {
        if (/(Share|Rate|combinationPct)$/.test(key) && (typeof v !== "string" || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1)) return invalid();
        if (v && typeof v === "object") validateShares(v);
      }
    };
    validateShares(row);
    const id = asin(isTerms ? row.clickedAsin : row.asin);
    if (!isTerms && (row.startDate !== policy.from || row.endDate !== policy.to)) return invalid();
    if (["search_query", "search_catalog"].includes(policy.reportKind) && !policy.asins.includes(id)) return invalid();
    const query = isTerms ? text(row.searchTerm, 5000) : policy.reportKind === "search_query" ? text(object(row.searchQueryData).searchQuery, 5000) : null;
    return observationFact("BRAND_" + policy.reportKind.toUpperCase(), [policy.from, policy.to, row.departmentName ?? null, id, query, row.purchasedWithAsin ?? null], { ...row, reportPeriod: policy.reportPeriod, from: policy.from, to: policy.to, shareUnit: "FRACTION_0_1", ...(isTerms ? { volumeAvailable: false } : {}) }, { asin: id, searchTerm: query });
  }).filter((row): row is SafeFact => row !== null);
  return deduplicateFacts(rows, policy.maxRows);
}

/** getPricing returns the authenticated seller's listings, independently of the
 * Featured Offer. Initial coverage is explicitly New/B2C, not every offer type. */
export function parseOwnPrices(raw: string, policy: PricingPolicy, marketplaceId: string, sellerId: string): SafeFact[] {
  const root = object(readFinanceJson(raw));
  if (root.errors !== undefined && array(root.errors, 100).length) return invalid();
  const seen = new Set<string>();
  const legacyMoney = (v: unknown) => { const m = object(v); return money({ amount: m.Amount, currencyCode: m.CurrencyCode }); };
  const rows = array(root.payload, 20).map(v => {
    const row = object(v), id = asin(row.ASIN);
    if (row.status !== "Success" || seen.has(id) || !policy.asins.includes(id)) return invalid(); seen.add(id);
    const product = object(row.Product), identifiers = object(product.Identifiers), market = object(identifiers.MarketplaceASIN);
    if (market.MarketplaceId !== marketplaceId || market.ASIN !== id) return invalid();
    if (identifiers.SKUIdentifier !== undefined) {
      const sku = object(identifiers.SKUIdentifier);
      if (sku.SellerId && sku.SellerId !== sellerId || sku.MarketplaceId && sku.MarketplaceId !== marketplaceId) return invalid();
    }
    const offers = array(product.Offers, 100).map(v => {
      const offer = object(v), buying = object(offer.BuyingPrice);
      if (offer.ItemCondition !== "New" || offer.offerType !== undefined && offer.offerType !== "B2C") return invalid();
      return { sellerSku: text(offer.SellerSKU, 255), offerType: "B2C", condition: "New", subCondition: text(offer.ItemSubCondition, 50), fulfillmentChannel: text(offer.FulfillmentChannel, 50), regularPrice: legacyMoney(offer.RegularPrice), listingPrice: legacyMoney(buying.ListingPrice), landedPrice: buying.LandedPrice === undefined ? null : legacyMoney(buying.LandedPrice), shipping: buying.Shipping === undefined ? null : legacyMoney(buying.Shipping) };
    });
    return observationFact("OWN_PRICE_ASIN", id, { asin: id, marketplaceId, sellerId, offers, condition: "New", offerType: "B2C", availability: offers.length ? "RETURNED" : "NO_OFFER_RETURNED" }, { asin: id });
  });
  if (seen.size !== policy.asins.length) return invalid();
  return rows;
}
