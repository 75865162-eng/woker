// Cloud role for injected offline HTTP fixtures; no real Amazon calls.
process.env.AMAZON_API_EXECUTION_ROLE = "cloud";
import assert from "node:assert/strict";
import test from "node:test";
import { createSponsoredProductsProductAdReader, createSponsoredProductsReadAdapter } from "../src/lib/amazon-ads/sync-adapter";
import { adsStructureCompleteStage, adsSyncStages, nextAdsStructureStage, parseAdsCheckpoint } from "../src/lib/amazon-ads/sync-policy";
import { normalizeDatasetQuery, mcpDatasets } from "../src/lib/amazon-sync/mcp-datasets";

const input = { region: "EU" as const, profileId: "123", clientId: "fixture", accessToken: "fixture", cursor: null };
const product = { adId: "801", adGroupId: "201", campaignId: "101", state: "ENABLED", sku: "fixture sku 中文", globalAdId: "global-fixture" };

test("Product Ad reader uses official v3 contract, preserves optional seller/vendor identity and pagination", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const reader = createSponsoredProductsProductAdReader(async (url, init) => {
    assert.equal(new Headers(init?.headers).get("Accept"), "application/vnd.spProductAd.v3+json");
    assert.equal(new Headers(init?.headers).get("Amazon-Advertising-API-Scope"), "123");
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ productAds: [{ ...product, extendedData: { lastUpdateDateTime: "2026-11-06T00:00:00Z" } }, { adId: "802", adGroupId: "201", campaignId: "101", state: "PAUSED", asin: "B000FIXTURE" }], nextToken: "page2" });
  });
  const page = await reader.readPage({ ...input, cursor: "page1" });
  assert.equal(requests[0].url, "https://advertising-api-eu.amazon.com/sp/productAds/list");
  assert.equal(requests[0].body.nextToken, "page1");
  assert.equal(requests[0].body.includeExtendedDataFields, true);
  assert.equal(page.nextCursor, "page2");
  assert.equal(page.entities[0].entityType, "SP:product-ad");
  assert.equal(page.entities[0].parentExternalId, "201");
  assert.equal(page.entities[0].payload.sku, product.sku);
  assert.equal(page.entities[0].payload.asin, undefined);
  assert.equal(page.entities[1].payload.sku, undefined);
  assert.equal(page.entities[1].payload.asin, "B000FIXTURE");
  assert.equal(page.entities[0].sourceUpdatedAt, "2026-11-06T00:00:00Z");
});

test("Product Ad rejects invalid required identities and optional types, without requiring seller and vendor fields together", async () => {
  for (const patch of [{ adId: 801 }, { adGroupId: null }, { campaignId: "bad" }, { state: "bad" }, { sku: 1 }, { asin: null }, { extendedData: { lastUpdateDateTime: "bad" } }]) {
    const reader = createSponsoredProductsProductAdReader(async () => Response.json({ productAds: [{ ...product, ...patch }] }));
    await assert.rejects(reader.readPage(input), { code: "ADS_PRODUCT_AD_RESPONSE_INVALID" });
  }
  const reader = createSponsoredProductsProductAdReader(async () => Response.json({ productAds: [{ adId: "1", adGroupId: "2", campaignId: "3", state: "OTHER" }] }));
  assert.equal((await reader.readPage(input)).entities.length, 1);
});

test("Product Ad composes with the existing adapter and obeys throttle failures without internal retry", async () => {
  let calls = 0;
  const adapter = createSponsoredProductsReadAdapter(async () => { calls++; return new Response("private upstream", { status: 429, headers: { "retry-after": "120" } }); });
  await assert.rejects(adapter.readPage({ ...input, stage: "product-ads" }), { code: "ADS_PRODUCT_AD_HTTP_429", retryAfterMs: 120000, retryable: true });
  assert.equal(calls, 1);
});

test("structure traversal appends Product Ad without reinterpreting any existing checkpoint index", () => {
  assert.deepEqual(adsSyncStages.slice(0, 6), ["campaigns", "ad-groups", "keywords", "targets", "negatives", "reports"]);
  assert.equal(nextAdsStructureStage(4), 6);
  assert.equal(nextAdsStructureStage(6), adsStructureCompleteStage);
  assert.equal(adsSyncStages[6], "product-ads");
  assert.deepEqual(parseAdsCheckpoint({ stage: 6, cursor: "opaque", pages: 2 }), { stage: 6, cursor: "opaque", pages: 2 });
  assert.throws(() => nextAdsStructureStage(5), { code: "ADS_REPORT_ADAPTER_NOT_IMPLEMENTED" });
});

test("MCP dataset accepts Product Ad in the existing scoped structure query", () => {
  const dataset = mcpDatasets.find(row => row.name === "ads_entities")!;
  assert.equal(normalizeDatasetQuery(dataset, { filters: { entityType: "SP:product-ad" } }).filters.entityType, "SP:product-ad");
});
