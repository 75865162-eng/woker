import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBrandCollection, brandCollectionWindows, brandTaskPolicy, assertBrandTaskPolicy, brandWindowKey } from "@/lib/amazon-sync/brand-collection";
import { parseObservationPolicy, assertObservationClosed, observationReportSpec, brandReportTypes, type AnalyticsPolicy } from "@/lib/amazon-sync/observation-policy";
import { parseObservationReport } from "@/lib/amazon-sync/observation-parsers";
import { brandFieldCatalogue } from "@/lib/amazon-sync/brand-field-catalogue";
import { brandFieldLabel } from "@/lib/amazon-sync/brand-fields";
import { brandReports } from "@/lib/amazon-sync/brand-reports";
import { advanceObservation, initialObservationState } from "@/lib/amazon-sync/observation-machine";
import { automaticMarketplaceAllowed, brandMarketplaces, automaticMarketplaces } from "@/lib/amazon-sync/automatic-schedule";
import { reportTimeZone } from "@/lib/amazon-sync/date-range";
import { brandProductMetadata } from "@/lib/amazon-sync/brand-product-links";
const asin = "B123456789", site = "ATVPDKIKX0DER";
test("brand product association never borrows another marketplace's title or brand", () => {
  assert.deepEqual(brandProductMetadata({ summaries: [{ marketplaceId: "foreign", itemName: "Private", brandName: "Foreign" }] }, site), { title: null, brand: null });
  assert.deepEqual(brandProductMetadata({ summaries: [{ marketplaceId: "foreign", itemName: "Private" }, { marketplaceId: site, itemName: "Scoped", brandName: "Local" }] }, site), { title: "Scoped", brand: "Local" });
});
test("brand attributes fill only explicitly scoped missing metadata without exposing unknown payload", () => {
  assert.deepEqual(brandProductMetadata({ attributes: { brand: [{ marketplace_id: "foreign", value: "Private" }, { marketplace_id: site, value: "Scoped" }], item_name: [{ value: "Unscoped" }], secret_contact: "Private" } }, site), { title: null, brand: "Scoped" });
  assert.deepEqual(brandProductMetadata(null, site), { title: null, brand: null });
});
const input = { from: "2025-01-05", to: "2025-01-18", asins: [asin], selections: [{ reportKind: "search_query", reportPeriod: "WEEK" }], maxTasks: 100 };
function root(collection?: unknown) { return parseObservationPolicy({ resource: "brand_analytics", applicationId: "fixture", maxRequests: 30, maxRows: 1000, requestsPerSecond: .01, reportKind: "search_terms", reportPeriod: "WEEK", from: "2025-01-05", to: "2025-01-11", asins: [], marketplaceTimeZone: "America/Los_Angeles", brandEligibilityAttested: true, ...(collection ? { collection } : {}) }) as AnalyticsPolicy; }

test("finite manifest splits complete periods and all ASINs without broadening edges", () => {
  const c = parseBrandCollection({ ...input, from: "2025-01-06", to: "2025-01-25", asins: Array.from({ length: 37 }, (_, i) => `B${String(i).padStart(9, "0")}`) });
  const windows = brandCollectionWindows(c);
  assert.equal(windows.length, 6); assert.equal(windows[0].from, "2025-01-12"); assert.equal(windows.at(-1)!.to, "2025-01-25");
  assert.deepEqual(windows.slice(0, 3).map(w => w.asins.length), [18, 18, 1]);
  assert.equal(new Set(windows.map(brandWindowKey)).size, 6);
  assert.ok(windows.every(w => observationReportSpec(brandTaskPolicy(root(c), w), site).reportOptions.asin.length <= 200));
});
test("all five report kinds support separate legal grains and unscoped reports have no ASIN filter", () => {
  const c = parseBrandCollection({ ...input, selections: Object.keys(brandReports).map(reportKind => ({ reportKind, reportPeriod: "WEEK" })) });
  const p = root(c), windows = brandCollectionWindows(c); assert.equal(windows.length, 10);
  for (const window of windows) {
    const candidate = parseObservationPolicy(brandTaskPolicy(p, window)) as AnalyticsPolicy;
    assert.doesNotThrow(() => assertBrandTaskPolicy(p, candidate));
    assert.equal(brandReportTypes[window.reportKind], brandReports[window.reportKind].reportType);
    if (!brandReports[window.reportKind].asinScoped) assert.deepEqual(window.asins, []);
  }
});
test("manifest rejects unsupported grains, empty objects, duplicates, oversize and nonclosed dates", () => {
  for (const override of [{ maxTasks: 1 }, { asins: [] }, { asins: [asin, asin] }, { selections: [...input.selections, ...input.selections] }, { selections: [{ reportKind: "repeat_purchase", reportPeriod: "DAY" }] }, { from: "2025-01-06", to: "2025-01-07" }, { from: "2025-02-30" }]) assert.throws(() => parseBrandCollection({ ...input, ...override }));
  assert.throws(() => assertObservationClosed(root(input), new Date("2025-01-18T12:00:00Z"), site));
  assert.doesNotThrow(() => assertObservationClosed(root(input), new Date("2025-01-19T12:00:00Z"), site));
});
test("frozen child cannot escape its source report/date/object/identity/budget", () => {
  const p = root(input), child = brandTaskPolicy(p, brandCollectionWindows(p.collection!)[0]);
  for (const fields of [{ asins: ["B987654321"] }, { maxRows: 5000 }, { from: "2024-01-07", to: "2024-01-13" }, { applicationId: "other" }, { requestsPerSecond: .1 }, { marketplaceTimeZone: "UTC" }, { collection: p.collection }]) assert.throws(() => assertBrandTaskPolicy(p, { ...child, ...fields }));
});
test("monthly and quarter windows handle leap years and never synthesize daily facts", () => {
  const c = parseBrandCollection({ ...input, from: "2024-01-01", to: "2024-03-31", selections: [{ reportKind: "repeat_purchase", reportPeriod: "MONTH" }, { reportKind: "repeat_purchase", reportPeriod: "QUARTER" }] });
  const windows = brandCollectionWindows(c); assert.equal(windows.length, 4);
  assert.ok(windows.some(w => w.from === "2024-02-01" && w.to === "2024-02-29"));
  assert.ok(windows.some(w => w.reportPeriod === "QUARTER" && w.to === "2024-03-31"));
});
test("repeat purchase full official fields survive as exact values; invalid percentages and periods reject", () => {
  const raw = JSON.parse(readFileSync("src/data/amazon-contracts/sellingPartnerRepeatPurchaseReport.json", "utf8")).examples[0];
  const p = parseObservationPolicy({ ...root(), reportKind: "repeat_purchase", from: "2021-06-06", to: "2021-06-12" }) as AnalyticsPolicy;
  raw.reportSpecification = observationReportSpec(p, site); raw.dataByAsin = raw.dataByAsin.filter((v: { endDate: string }) => v.endDate === p.to); raw.secretContact = "DO_NOT_EXPOSE";
  const rows = parseObservationReport(JSON.stringify(raw), p, site);
  assert.equal(rows.length, 2); assert.equal(rows[0].kind, "BRAND_REPEAT_PURCHASE"); assert.equal(rows[0].facts.orders, "1256"); assert.equal(rows[0].facts.uniqueCustomers, "1201");
  assert.deepEqual({ ...(rows[0].facts.repeatPurchaseRevenue as Record<string, unknown>) }, { amount: "2246.13", currencyCode: "USD" });
  assert.equal(rows[0].facts.repeatCustomersPctTotal, "0.0083"); assert.ok(!JSON.stringify(rows).includes("DO_NOT_EXPOSE"));
  raw.dataByAsin[0].repeatPurchaseRevenuePctTotal = 1.1; assert.throws(() => parseObservationReport(JSON.stringify(raw), p, site));
  assert.throws(() => parseObservationPolicy({ ...p, reportPeriod: "DAY", to: p.from }));
  const state = { ...initialObservationState(p), stage: "POLL" as const, reportId: "fixture" };
  assert.equal(advanceObservation(p, state, { reportId: "fixture", reportType: brandReportTypes.repeat_purchase, marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: "doc" }, { marketplaceId: site, sellerId: "fixture", rawBody: "" }).state.stage, "DOCUMENT");
});
test("brand and automatic domains share verified reporting sites", () => {
  assert.equal(brandMarketplaces.size, 18);
  for (const id of brandMarketplaces) { assert.ok(reportTimeZone(id)); assert.equal(automaticMarketplaceAllowed("brand_analytics", id), true); }
  assert.equal(automaticMarketplaceAllowed("orders", "A1PA6795UKMFR9"), true); assert.equal(automaticMarketplaces.size, 18);
});

test("repeat purchase preserves upstream null metrics while keeping identity and non-null contracts strict", () => {
  const raw = JSON.parse(readFileSync("src/data/amazon-contracts/sellingPartnerRepeatPurchaseReport.json", "utf8")).examples[0];
  const p = parseObservationPolicy({ ...root(), reportKind: "repeat_purchase", from: "2021-06-06", to: "2021-06-12" }) as AnalyticsPolicy;
  raw.reportSpecification.dataEndTime = p.to;
  raw.dataByAsin = [raw.dataByAsin[0]];
  const names = ["orders", "uniqueCustomers", "repeatCustomersPctTotal", "repeatPurchaseRevenue", "repeatPurchaseRevenuePctTotal"];
  for (const name of names) raw.dataByAsin[0][name] = null;
  const rows = parseObservationReport(JSON.stringify(raw), p, site);
  for (const name of names) assert.equal(rows[0].facts[name], null);
  const invalid = (patch: Record<string, unknown>) => JSON.stringify({ ...raw, dataByAsin: [{ ...raw.dataByAsin[0], ...patch }] });
  for (const patch of [{ asin: null }, { startDate: null }, { orders: -1 }, { repeatCustomersPctTotal: 1.1 }, { repeatPurchaseRevenue: { amount: "bad", currencyCode: "USD" } }]) {
    assert.throws(() => parseObservationReport(invalid(patch), p, site));
  }
  delete raw.dataByAsin[0].orders;
  assert.throws(() => parseObservationReport(JSON.stringify(raw), p, site));
});


test("catalog preserves unavailable prices and conversion without weakening metric or identity validation", () => {
  const raw = JSON.parse(readFileSync("src/data/amazon-contracts/sellingPartnerSearchCatalogPerformanceReport.json", "utf8")).examples[0];
  const p = parseObservationPolicy({ ...root(), reportKind: "search_catalog", asins: [asin] }) as AnalyticsPolicy;
  raw.reportSpecification = observationReportSpec(p, site);
  raw.dataByAsin = [raw.dataByAsin[0]];
  const row = raw.dataByAsin[0];
  row.impressionData.impressionMedianPrice = null;
  row.clickData.clickedMedianPrice = null;
  row.cartAddData.cartAddedMedianPrice = null;
  row.purchaseData.conversionRate = null;
  row.purchaseData.purchaseMedianPrice = null;
  const facts = parseObservationReport(JSON.stringify(raw), p, site)[0].facts;
  assert.equal((facts.impressionData as Record<string, unknown>).impressionMedianPrice, null);
  assert.equal((facts.clickData as Record<string, unknown>).clickedMedianPrice, null);
  assert.equal((facts.cartAddData as Record<string, unknown>).cartAddedMedianPrice, null);
  assert.equal((facts.purchaseData as Record<string, unknown>).conversionRate, null);
  assert.equal((facts.purchaseData as Record<string, unknown>).purchaseMedianPrice, null);
  for (const mutate of [
    (r: typeof row) => { r.asin = null; },
    (r: typeof row) => { r.purchaseData.conversionRate = 1.1; },
    (r: typeof row) => { r.clickData.clickCount = null; },
    (r: typeof row) => { r.impressionData.impressionCount = null; },
    (r: typeof row) => { r.impressionData.impressionMedianPrice = { amount: null, currencyCode: "USD" }; },
    (r: typeof row) => { delete r.impressionData.impressionMedianPrice; },
    (r: typeof row) => { r.clickData.clickedMedianPrice = { amount: -1, currencyCode: "USD" }; },
    (r: typeof row) => { delete r.purchaseData.conversionRate; },
  ]) {
    const candidate = structuredClone(raw); mutate(candidate.dataByAsin[0]);
    assert.throws(() => parseObservationReport(JSON.stringify(candidate), p, site));
  }
});


test("every official brand business field has a receiver-page field entry and translated label", () => {
  const names = { search_terms: "SearchTerms", search_query: "SearchQueryPerformance", search_catalog: "SearchCatalogPerformance", market_basket: "MarketBasketAnalysis", repeat_purchase: "RepeatPurchase" };
  type Schema = { $ref?: string; type?: string; properties?: Record<string, Schema>; items?: Schema };
  for (const [kind, name] of Object.entries(names)) {
    const schema = JSON.parse(readFileSync(`src/data/amazon-contracts/sellingPartner${name}Report.json`, "utf8"));
    const paths: string[] = [];
    function walk(input: Schema, path = "") {
      const node: Schema = input.$ref ? schema.definitions[input.$ref.split("/").at(-1)!] : input;
      if (node.type === "object" && !(node.properties?.amount && node.properties?.currencyCode)) {
        for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, path ? `${path}.${key}` : key);
      } else if (node.type === "array") walk(node.items!, path);
      else paths.push(path);
    }
    walk(schema.properties[kind === "search_terms" ? "dataByDepartmentAndSearchTerm" : "dataByAsin"].items);
    assert.deepEqual(brandFieldCatalogue[kind as keyof typeof names], paths);
    for (const path of paths) for (const key of path.split(".")) assert.ok(/[\u4e00-\u9fff]|^ASIN$/.test(brandFieldLabel(key)), path);
  }
});

test("SQP preserves observed unavailable shares/prices while other fields remain strict", () => {
  const raw = JSON.parse(readFileSync("src/data/amazon-contracts/sellingPartnerSearchQueryPerformanceReport.json", "utf8")).examples[0];
  const p = parseObservationPolicy({ ...root(), reportKind: "search_query", asins: [asin] }) as AnalyticsPolicy;
  raw.reportSpecification = observationReportSpec(p, site); raw.dataByAsin = [raw.dataByAsin[0]];
  const nullable = { clickData: ["asinMedianClickPrice"], cartAddData: ["asinCartAddShare", "totalMedianCartAddPrice", "asinMedianCartAddPrice"], purchaseData: ["asinPurchaseShare", "totalMedianPurchasePrice", "asinMedianPurchasePrice"] };
  for (const [group, names] of Object.entries(nullable)) for (const name of names) raw.dataByAsin[0][group][name] = null;
  const facts = parseObservationReport(JSON.stringify(raw), p, site)[0].facts;
  for (const [group, names] of Object.entries(nullable)) for (const name of names) assert.equal((facts[group] as Record<string, unknown>)[name], null);
  type Row = (typeof raw.dataByAsin)[number];
  for (const mutate of [
    (r: Row) => { r.asin = null; },
    (r: Row) => { r.startDate = null; },
    (r: Row) => { r.searchQueryData.searchQuery = null; },
    (r: Row) => { r.cartAddData.asinCartAddCount = null; },
    (r: Row) => { r.purchaseData.asinPurchaseShare = 100.1; },
    (r: Row) => { r.cartAddData.asinCartAddShare = -0.1; },
    (r: Row) => { r.clickData.asinClickShare = null; },
    (r: Row) => { r.clickData.asinMedianClickPrice = { amount: null, currencyCode: "USD" }; },
    (r: Row) => { delete r.clickData.asinMedianClickPrice; },
    (r: Row) => { r.purchaseData.asinMedianPurchasePrice = { amount: null, currencyCode: "USD" }; },
    (r: Row) => { r.cartAddData.totalMedianCartAddPrice = { amount: 1, currencyCode: "bad" }; },
    (r: Row) => { delete r.purchaseData.asinPurchaseShare; },
  ]) {
    const candidate = structuredClone(raw); mutate(candidate.dataByAsin[0]);
    assert.throws(() => parseObservationReport(JSON.stringify(candidate), p, site));
  }
});


test("SQP retains native percent or fraction lexemes without guessing or changing other report units", () => {
  const raw = JSON.parse(readFileSync("src/data/amazon-contracts/sellingPartnerSearchQueryPerformanceReport.json", "utf8")).examples[0];
  const p = parseObservationPolicy({ ...root(), reportKind: "search_query", asins: [asin] }) as AnalyticsPolicy;
  raw.reportSpecification = observationReportSpec(p, site); raw.dataByAsin = [raw.dataByAsin[0]];
  raw.dataByAsin[0].impressionData.asinImpressionShare = 5.26;
  raw.dataByAsin[0].clickData.totalClickRate = 600;
  raw.dataByAsin[0].clickData.asinClickShare = 25;
  raw.dataByAsin[0].cartAddData.totalCartAddRate = 50;
  const facts = parseObservationReport(JSON.stringify(raw), p, site)[0].facts;
  assert.equal(facts.shareUnit, "AMAZON_NATIVE_SQP");
  assert.equal((facts.impressionData as Record<string, unknown>).asinImpressionShare, "5.26");
  assert.equal((facts.clickData as Record<string, unknown>).totalClickRate, "600");
  assert.equal((facts.clickData as Record<string, unknown>).asinClickShare, "25");
  assert.equal((facts.purchaseData as Record<string, unknown>).asinPurchaseShare, "0.05");
  const bad = structuredClone(raw); bad.dataByAsin[0].clickData.asinClickShare = 100.01;
  assert.throws(() => parseObservationReport(JSON.stringify(bad), p, site));
});
