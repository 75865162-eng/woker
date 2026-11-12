import assert from "node:assert/strict";
import test from "node:test";
import official from "@/data/amazon-contracts/promotions_2025-12-01.json";
import { advancePromotions, assertPromotionSummaryMatchesDetail, initialPromotionsState, promotionsRequest, promotionTypes, promotionStatuses, reusablePromotionSummary, validatePromotionsState } from "@/lib/amazon-sync/promotions";
import { parseObservationPolicy, assertObservationRoles } from "@/lib/amazon-sync/observation-policy";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
const site = "ATVPDKIKX0DER";
const detail = (extra = {}) => ({ promotionId: "p", marketplaceId: site, promotionType: "COUPON", status: "RUNNING", promotionTitle: "Test", trackingId: "t", createdDate: "2026-09-01T00:00:00Z", lastUpdatedDate: "2026-10-01T00:00:00Z", schedule: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-09-30T00:00:00Z" }, selection: { type: "CATALOG", selectionDetails: { rules: { excludedItems: [{ asin: "B123456789" }] } } }, ...extra });
const discovered = () => advancePromotions(JSON.stringify({ totalResults: 1, promotions: [detail()] }), initialPromotionsState(), site).state;
for (const promotionType of promotionTypes) for (const status of promotionStatuses) test("promotion contract " + promotionType + "/" + status, () => {
  const value = detail({ promotionType, status });
  const parsed = advancePromotions(JSON.stringify(value), discovered(), site);
  assert.equal(parsed.rows[0].kind, "PROMOTION"); assert.equal(parsed.state.stage, "VERIFY");
  const done = advancePromotions(JSON.stringify(value), parsed.state, site); assert.equal(done.state.stage, "COMPLETE"); validatePromotionsState(done.state);
});
test("official operations, rate limits, defaults and fee snapshot stay frozen", () => {
  const operations = Object.values(official.paths).flatMap(path => Object.values(path).filter(value => value && typeof value === "object" && "operationId" in value).map(value => (value as { operationId: string }).operationId));
  for (const name of ["searchPromotions", "getPromotion", "getSelection"]) assert.ok(operations.includes(name));
  assert.ok(official.definitions.PromotionFeeSnapshot.properties.previewedFeeRates);
  const adapter = automaticAdapter("promotions")!; assert.equal(adapter.executionKind, "observation"); assert.equal(adapter.plannerKind, "observation"); assert.equal(adapter.discoveryScope, "marketplace");
  const policy = parseObservationPolicy({ resource: "promotions", applicationId: "test", maxRequests: 100, maxRows: 1000, requestsPerSecond: .1 });
  assert.throws(() => assertObservationRoles(policy, { approvedRoles: [], rolesAttestedAt: new Date() }));
  assertObservationRoles(policy, { approvedRoles: ["Pricing"], rolesAttestedAt: new Date() });
});
test("empty pages retain filters; token loop and omitted results fail closed", () => {
  const first = advancePromotions('{"totalResults":1,"promotions":[],"pagination":{"nextToken":"next"}}', initialPromotionsState(), site);
  const request = promotionsRequest(first.state, site), query = new URL(request.path, "https://test.invalid").searchParams;
  assert.equal(query.get("revision"), "ANY"); assert.equal(query.get("marketplaceIds"), site); assert.equal(query.get("paginationToken"), "next");
  assert.throws(() => advancePromotions('{"totalResults":1,"promotions":[],"pagination":{"nextToken":"next"}}', first.state, site));
  assert.throws(() => advancePromotions('{"totalResults":1,"promotions":[]}', initialPromotionsState(), site));
});
test("latest and purchase selections stay revision-specific; unknown/null/exact values survive", () => {
  const value = detail({ selection: { type: "ITEMS", selectionId: "sel", revisionId: 1 }, latestRevision: { ...detail(), revisionStatus: "FAILED", selection: { type: "ITEMS", selectionId: "sel", revisionId: 2 }, purchaseRequirements: { selection: { type: "ITEMS", selectionId: "purchase", revisionId: 1 } } } });
  const parsed = advancePromotions(JSON.stringify(value), discovered(), site);
  assert.equal(parsed.state.selections.length, 3); assert.equal(parsed.rows.length, 2);
  const page = advancePromotions('{"selection":{"type":"ITEMS","selectionId":"sel","revisionId":1,"selectionDetails":{"items":[{"sku":"sku","unknown":{"n":9007199254740993.123456789,"missing":null}}],"issues":[{"identifier":{"sku":"sku"},"code":"REJECTED","severity":"ERROR"}]}}}', parsed.state, site);
  assert.equal(page.state.selectionIndex, 1);
  assert.deepEqual((page.rows[1].facts.item as { unknown: unknown }).unknown, { n: "9007199254740993.123456789", missing: null });
  assert.throws(() => advancePromotions('{"selection":{"type":"ITEMS","selectionId":"sel","revisionId":1,"selectionDetails":{"items":[]}}}', page.state, site));
});
test("detail revision drift and marketplace mismatch cannot publish", () => {
  const state = discovered(); assert.throws(() => advancePromotions(JSON.stringify(detail({ marketplaceId: "FOREIGN" })), state, site));
  const parsed = advancePromotions(JSON.stringify(detail()), state, site);
  assert.throws(() => advancePromotions(JSON.stringify(detail({ lastUpdatedDate: "2026-10-02T00:00:00Z" })), parsed.state, site));
});
test("incremental reuse only unchanged old terminal revisions with weekly full detail reconciliation", () => {
  const old = detail({ status: "EXPIRED" }), now = new Date("2026-11-10T00:00:00Z");
  assert.equal(reusablePromotionSummary(old, old, new Date("2026-11-09"), now), true);
  assert.equal(reusablePromotionSummary(old, old, new Date("2026-11-01"), now), false);
  assert.equal(reusablePromotionSummary(old, detail({ status: "RUNNING" }), new Date("2026-11-09"), now), false);
  assert.equal(reusablePromotionSummary(old, { ...old, lastUpdatedDate: "2026-11-09T00:00:00Z" }, new Date("2026-11-09"), now), false);
});

test("search/detail drift cannot publish and official unconstrained title strings survive", () => {
  assertPromotionSummaryMatchesDetail(detail(), detail({ issues: [] }));
  assert.throws(() => assertPromotionSummaryMatchesDetail(detail(), detail({ status: "EXPIRED" })));
  assert.throws(() => assertPromotionSummaryMatchesDetail(detail(), detail({ lastUpdatedDate: "2026-10-02T00:00:00Z" })));
  for (const promotionTitle of ["", "x".repeat(501)]) assert.equal(advancePromotions(JSON.stringify(detail({ promotionTitle })), discovered(), site).rows.length, 1);
});
