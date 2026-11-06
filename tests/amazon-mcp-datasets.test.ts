import assert from "node:assert/strict";
import test from "node:test";
import { mcpDatasets, datasetForTable, resolveMcpDataset, normalizeDatasetQuery, datasetFilterProperties, datasetInputSchema, enrichDatasetResult, presentMcpReport, McpDatasetError } from "../src/lib/amazon-sync/mcp-datasets";

const now = new Date("2026-11-06T00:00:00Z");
const rejected = (run: () => unknown, businessCode: string) => assert.throws(run, error => error instanceof McpDatasetError && error.businessCode === businessCode);

test("all four legacy tables resolve to the same explicit datasets; conflicting and incomplete locators fail", () => {
  for (const dataset of mcpDatasets) {
    assert.equal(resolveMcpDataset({ module: dataset.module, dataType: dataset.dataType }), dataset);
    if (dataset.legacyTable) {
      assert.equal(resolveMcpDataset({ table: dataset.legacyTable }), dataset);
      assert.equal(resolveMcpDataset({ table: dataset.legacyTable, module: dataset.module, dataType: dataset.dataType }), dataset);
    }
  }
  rejected(() => resolveMcpDataset({ table: "inventory", module: "amazon_sync", dataType: "listings" }), "DATASET_LOCATOR_CONFLICT");
  rejected(() => resolveMcpDataset({ table: "inventory", module: "amazon_sync" }), "DATASET_LOCATOR_INVALID");
  rejected(() => resolveMcpDataset({}), "DATASET_LOCATOR_INVALID");
  rejected(() => resolveMcpDataset({ table: "sales_traffic_asin" }), "SCHEMA_UNVERIFIED");
  rejected(() => resolveMcpDataset({ table: "AmazonInventorySnapshot" }), "TABLE_NOT_ALLOWED");
  rejected(() => resolveMcpDataset({ table: "ads_entities" }), "TABLE_NOT_ALLOWED");
});

test("dataset filter semantics reject unsupported dimensions and reconcile only documented aliases", () => {
  const sales = datasetForTable("sales_traffic_daily");
  for (const field of ["asin", "sellerSku", "campaignId", "status", "keyword", "search", "arbitraryField", "constructor", "toString", "__proto__"]) {
    rejected(() => normalizeDatasetQuery(sales, { filters: { [field]: "anything" } }, now), "FIELD_NOT_MAPPED");
  }
  const entities = mcpDatasets.find(dataset => dataset.name === "ads_entities")!;
  for (const field of ["from", "to", "keyword", "asin", "sellerSku"]) rejected(() => normalizeDatasetQuery(entities, { filters: { [field]: "2026-11-01" } }, now), "FIELD_NOT_MAPPED");
  const listings = normalizeDatasetQuery(datasetForTable("listings"), { filters: { status: "ACTIVE" }, state: "ACTIVE", listingStatus: "ACTIVE" }, now);
  assert.equal(listings.filters.listingStatus, "ACTIVE");
  assert.equal(datasetForTable("listings").fields.find(field => field.name === "listingAttributes")?.type, "object");
  rejected(() => normalizeDatasetQuery(datasetForTable("listings"), { filters: { status: "ACTIVE" }, listingStatus: "INACTIVE" }, now), "FILTER_CONFLICT");
  const report = normalizeDatasetQuery(datasetForTable("ads_report_daily"), { asin: "B000FIXTURE", keyword: "exact term" }, now);
  assert.equal(report.filters.advertisedAsin, "B000FIXTURE");
  assert.equal(report.filters.searchTerm, "exact term");
  rejected(() => normalizeDatasetQuery(datasetForTable("inventory"), { filters: { sellerSku: "" } }, now), "FILTER_INVALID");
  rejected(() => normalizeDatasetQuery(datasetForTable("inventory"), { filters: { sellerSku: "a" }, sellerSku: "b" }, now), "FILTER_CONFLICT");
});

test("date defaults are bounded, UTC snapshot capture differs from business labels, structure has no date window", () => {
  const sales = normalizeDatasetQuery(datasetForTable("sales_traffic_daily"), {}, now);
  assert.equal(sales.filters.from, "2026-10-31");
  assert.equal(sales.filters.to, "2026-11-06");
  const inventory = normalizeDatasetQuery(datasetForTable("inventory"), {}, now);
  assert.equal(inventory.filters.from, undefined);
  const report = normalizeDatasetQuery(datasetForTable("ads_report_daily"), { to: "2026-11-01" }, now);
  assert.equal(report.filters.from, "2026-10-03");
  for (const date of ["2026-02-30", "2026-2-01", "2026-11-01T00:00:00Z"]) rejected(() => normalizeDatasetQuery(datasetForTable("inventory"), { from: date }, now), "DATE_RANGE_INVALID");
  rejected(() => normalizeDatasetQuery(datasetForTable("sales_traffic_daily"), { from: "2020-01-01", to: "2026-11-01" }, now), "DATE_RANGE_INVALID");
  rejected(() => normalizeDatasetQuery(datasetForTable("inventory"), { from: "2026-11-02", to: "2026-11-01" }, now), "DATE_RANGE_INVALID");
});

test("filter schemas and runtime share paging and sort allowlists, including the Ads cap", () => {
  for (const dataset of mcpDatasets) {
    const normalized = normalizeDatasetQuery(dataset, { page: 10000, pageSize: dataset.maxPageSize }, now);
    assert.equal(normalized.pageSize, dataset.maxPageSize);
    for (const pageSize of [0, -1, 1.5, "10", dataset.maxPageSize + 1]) rejected(() => normalizeDatasetQuery(dataset, { pageSize }, now), "PAGINATION_INVALID");
    rejected(() => normalizeDatasetQuery(dataset, { sortBy: "payload.secret" }, now), "FILTER_INVALID");
    rejected(() => normalizeDatasetQuery(dataset, { sortDirection: "DESC; drop table" }, now), "FILTER_INVALID");
    assert.ok(datasetFilterProperties(dataset).sortBy.enum?.includes(normalized.filters.sortBy));
  }
  const schema = datasetInputSchema(true);
  assert.equal(schema.allOf?.length, 5);
  assert.equal(schema.properties.pageSize?.maximum, 1000);
});

test("metadata retains zero/null and exact values, uses true total for empty deep pages, and never invents currency", () => {
  const dataset = datasetForTable("ads_report_daily");
  const value = { data: { items: [{ spend: "9007199254740993.000001", impressions: "0", sales: null }], total: 1 }, meta: { page: { page: 1, pageSize: 100, hasNext: false }, publishedVersionIds: ["fixture"] } };
  const enriched = enrichDatasetResult(value, { dataset, requestId: "fixture-request", toolVersion: "1.1.0", filters: { from: "2026-11-01", to: "2026-11-01", sortBy: "reportDate", sortDirection: "desc" }, scopePairs: [{ sellerAccountId: "A", marketplaceId: "US" }, { sellerAccountId: "A", marketplaceId: "US" }] });
  assert.equal(enriched.data, value.data);
  assert.equal(enriched.meta.currency, null);
  assert.deepEqual(enriched.meta.scope.pairs, [{ sellerAccountId: "A", marketplaceId: "US" }]);
  assert.equal(enriched.meta.resultStatus, "AVAILABLE");
  const emptyPage = enrichDatasetResult({ data: { items: [], total: 1 }, meta: { page: { page: 2, pageSize: 100, hasNext: false } } }, { dataset, requestId: "fixture", toolVersion: "1.1.0", filters: {}, scopePairs: [] });
  assert.equal(emptyPage.meta.resultStatus, "AVAILABLE");
  assert.equal(emptyPage.pagination.total, 1);
  const empty = enrichDatasetResult({ data: { items: [], total: 0 }, meta: { page: { page: 1, pageSize: 100, hasNext: false } } }, { dataset, requestId: "fixture", toolVersion: "1.1.0", filters: {}, scopePairs: [] });
  assert.equal(empty.meta.resultStatus, "EMPTY_RESULT");
});

test("totals keep known currency groups separate and withhold mixed timezones or unknown comparison dimensions", () => {
  const totals = ["USD", "EUR"].map(currencyCode => ({ currencyCode, attributionWindow: "7d", apiVersion: "fixture-v1", spend: "9007199254740993.123456" }));
  const input = { rows: [], total: 2, totals, meta: { profiles: [{ timezone: "UTC" }] }, warnings: [] };
  const safe = presentMcpReport(input);
  assert.equal(safe.totals, totals);
  assert.equal(safe.totals?.length, 2);
  assert.equal(presentMcpReport({ ...input, meta: { profiles: [{ timezone: "UTC" }, { timezone: "America/Los_Angeles" }] } }).totals, null);
  assert.equal(presentMcpReport({ ...input, totals: [{ ...totals[0], attributionWindow: null }] }).totals, null);
  assert.equal(presentMcpReport({ ...input, totals: [{ ...totals[0], currencyCode: null }] }).totals, null);
  assert.deepEqual(presentMcpReport({ ...input, totals: [], total: 0 }).totals, []);
});
