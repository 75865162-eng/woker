import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseObservationPolicy, assertObservationClosed, observationReportSpec, assertObservationRoles, type AnalyticsPolicy, type PricingPolicy } from "../src/lib/amazon-sync/observation-policy";
import { advanceObservation, initialObservationState } from "../src/lib/amazon-sync/observation-machine";
import { parseCompetitivePrices, parseObservationReport } from "../src/lib/amazon-sync/observation-parsers";
import { parseProductDetail } from "../src/lib/amazon-sync/product-observations";
const base = { applicationId: "fixture-app", maxRows: 1000, maxRequests: 100, requestsPerSecond: .01 };
const site = "ATVPDKIKX0DER", id = "B123456789";
function policy(kind: string, fields: Record<string, unknown> = {}) { return parseObservationPolicy({ ...base, resource: "brand_analytics", asins: ["search_query", "search_catalog"].includes(kind) ? [id, "B987654321"] : [], reportKind: kind, reportPeriod: "WEEK", from: "2025-01-05", to: "2025-01-11", marketplaceTimeZone: "America/Los_Angeles", brandEligibilityAttested: true, ...fields }) as AnalyticsPolicy; }
function report(name: string) { return JSON.parse(readFileSync(`src/data/amazon-contracts/${name}.json`, "utf8")).examples[0]; }

test("observation scope normalizes allowlists, closed periods and exact report option names", () => {
  const p = policy("search_query"); assert.equal(observationReportSpec(p, site).reportOptions.asin, `${id} B987654321`);
  assert.equal(observationReportSpec(policy("search_catalog"), site).reportOptions.asins, `${id} B987654321`);
  assert.throws(() => policy("search_query", { reportPeriod: "DAY", to: "2025-01-05" }));
  assert.throws(() => policy("search_terms", { asins: [id] }));
  assert.throws(() => policy("market_basket", { from: "2025-01-06", to: "2025-01-12" }));
  assert.doesNotThrow(() => policy("search_terms", { brandEligibilityAttested: false }));
  assert.throws(() => assertObservationClosed(p, new Date("2025-01-11T12:00:00Z")));
  assert.doesNotThrow(() => assertObservationClosed(p, new Date("2025-01-12T12:00:00Z")));
  assert.doesNotThrow(() => assertObservationRoles(p, { approvedRoles: ["Brand Analytics"], rolesAttestedAt: null }));
});
for (const [kind, filename] of [["search_terms", "sellingPartnerSearchTermsReport"], ["search_query", "sellingPartnerSearchQueryPerformanceReport"], ["search_catalog", "sellingPartnerSearchCatalogPerformanceReport"], ["market_basket", "sellingPartnerMarketBasketAnalysisReport"]]) test(`official ${kind} example is accepted, scoped and strips unknown fields`, () => {
  const raw = report(filename), spec = raw.reportSpecification;
  // Market Basket example spans two weeks: this receiver deliberately supports one.
  if (kind === "market_basket") spec.dataEndTime = "2021-06-12";
  const p = policy(kind, { from: spec.dataStartTime, to: spec.dataEndTime });
  if (kind === "search_terms") raw.dataByDepartmentAndSearchTerm = raw.dataByDepartmentAndSearchTerm.filter((v: { clickedAsin: string }) => v.clickedAsin.length === 10); // upstream examples contain several invalid 11-character ASINs
  raw.privatePayload = "DO_NOT_EXPOSE";
  const rows = parseObservationReport(JSON.stringify(raw), p, site);
  assert.ok(rows.length); assert.ok(!JSON.stringify(rows).includes("DO_NOT_EXPOSE"));
  assert.throws(() => parseObservationReport(JSON.stringify(raw), p, "other-site"));
  if (kind === "search_terms") { assert.equal(rows[0].facts.volumeAvailable, false); assert.equal(rows[0].facts.clickShare, "0.0771"); }
});
test("report mismatched period, conflicting business rows and invalid shares never publish", () => {
  const raw = report("sellingPartnerSearchTermsReport"), spec = raw.reportSpecification;
  const p = policy("search_terms", { from: spec.dataStartTime, to: spec.dataEndTime });
  raw.dataByDepartmentAndSearchTerm[0].clickShare = 2;
  assert.throws(() => parseObservationReport(JSON.stringify(raw), p, site));
  raw.dataByDepartmentAndSearchTerm[0].clickShare = .1;
  raw.dataByDepartmentAndSearchTerm.push({ ...raw.dataByDepartmentAndSearchTerm[0], clickShare: .2 });
  assert.throws(() => parseObservationReport(JSON.stringify(raw), p, site));
});
test("pricing preserves exact decimals and segments, rejects missing/failed responses", () => {
  const p = parseObservationPolicy({ ...base, resource: "pricing", asins: [id] }) as PricingPolicy;
  const raw = `{"responses":[{"status":{"statusCode":200},"body":{"asin":"${id}","marketplaceId":"${site}","featuredBuyingOptions":[{"buyingOptionType":"New","segmentedFeaturedOffers":[{"sellerId":"seller","condition":"New","fulfillmentType":"AFN","listingPrice":{"amount":12.340000000000000001,"currencyCode":"USD"},"featuredOfferSegments":[{"customerMembership":"PRIME","segmentDetails":{},"secret":"hidden"}]}]}]}}]}`;
  const result = parseCompetitivePrices(raw, p, site, "seller");
  assert.ok(JSON.stringify(result).includes("12.340000000000000001")); assert.ok(!JSON.stringify(result).includes("hidden"));
  assert.throws(() => parseCompetitivePrices(raw.replace('"statusCode":200', '"statusCode":429'), p, site, "seller"));
  assert.throws(() => parseCompetitivePrices('{"responses":[]}', p, site, "seller"));
});
test("bounded inbound traversal verifies plan marketplace before children, detects plan drift", () => {
  const planId = "a".repeat(38), p = parseObservationPolicy({ ...base, resource: "fulfillment", planIds: [planId] });
  let s = initialObservationState(p);
  const plan = { inboundPlanId: planId, marketplaceIds: [site], name: "fixture", status: "ACTIVE", createdAt: "2025-01-01T00:00:00Z", lastUpdatedAt: "2025-01-01T00:00:00Z", shipments: [] };
  const context = { rawBody: "", marketplaceId: site, sellerId: "seller" };
  assert.throws(() => advanceObservation(p, s, { ...plan, marketplaceIds: ["other"] }, context));
  s = advanceObservation(p, s, plan, context).state;
  s = advanceObservation(p, s, { items: [] }, context).state;
  assert.equal(s.stage, "VERIFY_PLAN");
  assert.throws(() => advanceObservation(p, s, { ...plan, status: "CHANGED" }, context));
  assert.equal(advanceObservation(p, s, plan, context).state.stage, "COMPLETE");
});
test("Buy Box historical reports require a single day and reject missing required metrics", () => {
  assert.throws(() => parseObservationPolicy({ ...base, resource: "buy_box_history", asins: [id], from: "2025-01-01", to: "2025-01-02", marketplaceTimeZone: "UTC" }));
  const p = parseObservationPolicy({ ...base, resource: "buy_box_history", asins: [id], from: "2021-06-11", to: "2021-06-11", marketplaceTimeZone: "UTC" });
  if (p.resource !== "buy_box_history") throw new Error();
  const raw = report("sellerSalesAndTrafficReport"); raw.reportSpecification = observationReportSpec(p, site);
  raw.salesAndTrafficByDate = [raw.salesAndTrafficByDate[0]];
  raw.salesAndTrafficByAsin = [raw.salesAndTrafficByAsin[0]];
  raw.salesAndTrafficByAsin[0].childAsin = id;
  const traffic = raw.salesAndTrafficByAsin[0].trafficByAsin;
  // Upstream example uses mobilePageViews; the published schema requires mobileAppPageViews.
  traffic.mobileAppPageViews = traffic.mobilePageViews ?? 0;
  traffic.mobileAppPageViewsPercentage = traffic.mobilePageViewsPercentage ?? 0;
  const rows = parseObservationReport(JSON.stringify(raw), p, site);
  assert.equal(rows[0].facts.buyBoxPercentage, "95.24");
  delete raw.salesAndTrafficByAsin[0].trafficByAsin.buyBoxPercentage;
  assert.throws(() => parseObservationReport(JSON.stringify(raw), p, site));
});

test("official getPricing sandbox own offers remain independent of Featured Offer and preserve exact money", async () => {
  const { parseOwnPrices } = await import("../src/lib/amazon-sync/observation-parsers");
  const schema = JSON.parse(readFileSync("tests/fixtures/amazon-domain-contracts/productPricingV0.json", "utf8"));
  const example = schema.paths["/products/pricing/v0/price"].get.responses["200"]["x-amzn-api-sandbox"].static[0].response;
  const asins = example.payload.map((row: { ASIN: string }) => row.ASIN);
  const p = parseObservationPolicy({ ...base, resource: "pricing", asins }) as PricingPolicy;
  const raw = JSON.stringify(example).replace('"Amount":10', '"Amount":10.000000000000000001');
  const rows = parseOwnPrices(raw, p, site, "fixture-seller"); assert.equal(rows.length, 2);
  assert.ok(JSON.stringify(rows).includes("10.000000000000000001"));
  assert.throws(() => parseOwnPrices(raw, p, "foreign-marketplace", "fixture-seller"));
  example.payload[0].status = "ClientError";
  assert.throws(() => parseOwnPrices(JSON.stringify(example), p, site, "fixture-seller"));
});
test("pricing client sends the frozen v0 and 2022 read operations with separate telemetry", async () => {
  const { AmazonSpApiClient } = await import("../src/lib/amazon/sp-api-client");
  const calls: Array<{ url: URL; init?: RequestInit }> = [], operations: string[] = [];
  const client = new AmazonSpApiClient({ lwaClientId: "fixture", lwaClientSecret: "fixture", refreshToken: "fixture", awsAccessKeyId: "", awsSecretAccessKey: "", region: "us-east-1", endpoint: "https://fixture.invalid" }, { tokenEndpoint: "https://lwa.fixture.invalid/token", onResponse: e => operations.push(e.operation), fetch: async (url, init) => { calls.push({ url: new URL(String(url)), init }); return Response.json(String(url).includes("lwa.fixture.invalid") ? { access_token: "fixture", expires_in: 3600 } : {}); } });
  await client.getCompetitiveSummary({ asins: [id], marketplaceId: site }); await client.getOwnPrices({ asins: [id], marketplaceId: site });
  const own = calls.at(-1)!; assert.equal(own.init?.method, "GET"); assert.equal(own.url.pathname, "/products/pricing/v0/price"); assert.equal(own.url.searchParams.get("ItemCondition"), "New"); assert.equal(own.url.searchParams.get("OfferType"), "B2C");
  const batch = JSON.parse(String(calls[1].init?.body)); assert.deepEqual(batch.requests[0].includedData, ["featuredBuyingOptions", "referencePrices"]);
  assert.deepEqual(operations, ["LWA", "getCompetitiveSummary", "getPricing"]);
});
test("observation approval payload is scoped, stripped and reviewable without secrets", async () => {
  const { normalizeCommand, summary } = await import("../src/lib/amazon-sync/approval-policy");
  const command = normalizeCommand({ action: "save-source", resource: "fulfillment", domainPolicy: { ...base, resource: "fulfillment", planIds: ["a".repeat(38)], refreshToken: "DO_NOT_LEAK" } });
  assert.ok(!JSON.stringify(summary(command)).includes("DO_NOT_LEAK"));
  assert.throws(() => normalizeCommand({ ...command, resource: "pricing" }));
  assert.throws(() => assertObservationClosed(policy("search_terms"), new Date(), "A1VC38T7YXB528"));
});

for (const [resource, kind, input, expected] of [
  ["listing_details", "LISTING_DETAIL", { sku: "fixture-sku", summaries: [{ marketplaceId: site, asin: id, productType: "TEST", status: ["BUYABLE"], createdDate: "2025-01-01T00:00:00Z", lastUpdatedDate: "2025-01-02T00:00:00Z", itemName: "Fixture Listing" }, { marketplaceId: "other-site", productType: "OTHER", status: [], createdDate: "2025-01-01T00:00:00Z", lastUpdatedDate: "2025-01-02T00:00:00Z" }], attributes: { bullet_point: [{ marketplace_id: site, language_tag: "en_US", value: "Approved bullet" }], brand: [{ marketplace_id: site, value: "Fixture Brand" }], email: [{ marketplace_id: site, value: "private@example.invalid" }] }, relationships: [{ marketplaceId: site, relationships: [{ type: "VARIATION", childSkus: ["child-sku"] }] }], unknown: "PRIVATE" }, { asin: id, sellerSku: "fixture-sku" }],
  ["catalog_items", "CATALOG_DETAIL", { asin: id, summaries: [{ marketplaceId: site, brand: "Fixture Brand", itemName: "Fixture Catalog Item", itemClassification: "BASE_PRODUCT" }, { marketplaceId: "other-site", brand: "Other Brand", itemName: "Wrong Site" }], attributes: { brand: [{ marketplace_id: site, value: "Fixture Brand" }], email: [{ marketplace_id: site, value: "private@example.invalid" }] }, relationships: [{ marketplaceId: site, relationships: [{ type: "VARIATION", childAsins: ["C123456789"] }] }], unknown: "PRIVATE" }, { asin: id, sellerSku: null }],
] as const) test(`${resource} parser keeps approved marketplace fields and excludes unrelated payload`, () => {
  const policyValue = resource === "listing_details" ? { ...base, resource, sellerSkus: ["fixture-sku"] } : { ...base, resource, asins: [id] };
  const parsedPolicy = parseObservationPolicy(policyValue);
  const fact = parseProductDetail(JSON.stringify(input), parsedPolicy as Parameters<typeof parseProductDetail>[1], 0, site);
  assert.equal(fact.kind, kind); assert.equal(fact.asin, expected.asin); assert.equal(fact.sellerSku, expected.sellerSku);
  const serialized = JSON.stringify(fact.facts);
  assert.ok(!serialized.includes("PRIVATE")); assert.ok(!serialized.includes("private@example.invalid")); assert.ok(!serialized.includes("Wrong Site"));
  if (resource === "listing_details") assert.ok(serialized.includes("Approved bullet")); else assert.ok(serialized.includes("Fixture Catalog Item"));
  assert.throws(() => parseProductDetail(JSON.stringify(input), parsedPolicy as Parameters<typeof parseProductDetail>[1], 0, "absent-site"));
});
test("bounded product detail policy enforces seller SKU and ASIN allowlists", () => {
  assert.throws(() => parseObservationPolicy({ ...base, resource: "listing_details", sellerSkus: [] }));
  assert.throws(() => parseObservationPolicy({ ...base, resource: "catalog_items", asins: ["bad"] }));
  assert.throws(() => parseObservationPolicy({ ...base, resource: "catalog_items", asins: [id], requestsPerSecond: 1.01 }));
});
