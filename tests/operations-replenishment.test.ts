import assert from "node:assert/strict";
import test from "node:test";
import { calculateReplenishment, parseReplenishmentInputs } from "@/lib/operations/replenishment";
import { extractCatalogPage } from "@/lib/amazon/catalog";
import { parseSellerBindings } from "@/lib/amazon/seller-bindings";

const today = "2026-10-23";
const history = Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.parse(today) - (i + 1) * 86400000).toISOString().slice(0, 10), units: 10 }));
const inputs = () => parseReplenishmentInputs({ lifecycle: "MATURE", productionDays: 10, domesticDays: 5, oceanDays: 20, safetyDays: 7, reviewDays: 14, salesHistory: history, sourceNote: "ERP historical quantities + supplier confirmed lead time" });

test("mature plan uses complete history and known ETA only, forecasts shortage before replenishment", () => {
  const result = calculateReplenishment(inputs(), { available: 100, inbound: 200, fresh: true }, today);
  assert.equal(result.status, "READY"); assert.equal(result.dailyDemand, 10); assert.equal(result.daysOfCover, 10);
  assert.equal(result.suggestedQuantity, 460); assert.equal(result.estimatedStockoutDate, "2026-11-02"); assert.equal(result.urgency, "URGENT");
  assert.ok(result.reasons.some((row) => row.includes("未定到货日")));
});
test("missing sales days, lead time or stale inventory prevents quantity suggestion", () => {
  const parameters = inputs(); parameters.salesHistory.pop(); parameters.oceanDays = null;
  const result = calculateReplenishment(parameters, { available: 100, inbound: 0, fresh: false }, today);
  assert.equal(result.status, "NEEDS_DATA"); assert.equal(result.suggestedQuantity, null); assert.equal(result.urgency, "UNKNOWN");
  assert.equal(result.missingInputs.length, 3);
});
test("new items require explicit demand and do not borrow mature averages", () => {
  const parameters = inputs(); parameters.lifecycle = "NEW";
  assert.equal(calculateReplenishment(parameters, { available: 100, inbound: 0, fresh: true }, today).status, "NEEDS_DATA");
  parameters.newProductDailyUnits = 2;
  assert.equal(calculateReplenishment(parameters, { available: 100, inbound: 0, fresh: true }, today).dailyDemand, 2);
});
test("known late ETA does not hide prearrival stockout and missing seasonality stays explicit", () => {
  const parameters = inputs(); parameters.receipts = [{ eta: "2026-11-10", quantity: 200 }];
  const result = calculateReplenishment(parameters, { available: 100, inbound: 200, fresh: true }, today);
  assert.equal(result.suggestedQuantity, 260); assert.equal(result.estimatedStockoutDate, "2026-11-02");
  assert.ok(result.reasons.some((row) => row.includes("未提供去年同期")));
});
test("duplicate/invalid history and unproven seasonality are rejected", () => {
  assert.throws(() => parseReplenishmentInputs({ ...inputs(), salesHistory: [...history, history[0]] }));
  assert.throws(() => parseReplenishmentInputs({ ...inputs(), seasonality: { multiplier: 2 } }));
  assert.throws(() => parseReplenishmentInputs({ ...inputs(), unitProfit: 5 }));
});
test("catalog takes only matching marketplace status and unknown fields remain null", () => {
  const page = extractCatalogPage({ items: [{ sku: "SKU-A", summaries: [{ marketplaceId: "US", asin: "B1", status: ["BUYABLE"] }, { marketplaceId: "CA", asin: "B2", status: ["DISCOVERABLE"] }] }, { sku: "SKU-B" }], pagination: { nextToken: "next" } }, "US");
  assert.equal(page.items[0].asin, "B1"); assert.equal(page.items[0].listingStatus, "BUYABLE"); assert.equal(page.items[1].listingStatus, null); assert.equal(page.nextToken, "next");
  assert.throws(() => extractCatalogPage({}, "US"));
});
test("seller binding never assumes accountKey is seller ID and requires explicit authorized resources", () => {
  assert.deepEqual(parseSellerBindings(undefined), []);
  assert.throws(() => parseSellerBindings(JSON.stringify([{ accountKey: "not-a-seller-id" }])));
  const binding = { organizationId: "org", workspaceId: "ws", sellerAccountId: "store", marketplaceId: "US", amazonSellerId: "actual-id", authorizedResources: ["inventory", "catalog"] };
  assert.equal(parseSellerBindings(JSON.stringify([binding]))[0].sellerAccountId, "store");
  assert.throws(() => parseSellerBindings(JSON.stringify([binding, binding])));
});

test("ERP history rejects missing source values, duplicate dates and multi-MSKU aggregates", async () => {
  const { extractHistoricalSales } = await import("@/lib/operations/historical-sales");
  const rows = extractHistoricalSales([
    { reportDate: "2026-10-01", msku: "SKU", payload: { saleNum: 0 } },
    { reportDate: "2026-10-02", msku: "SKU", payload: {} },
    { reportDate: "2026-10-03", msku: "SKU", payload: { saleNum: "" } },
    { reportDate: "2026-10-04", msku: "SKU", payload: { saleNum: 5 } },
    { reportDate: "2026-10-04", msku: "SKU", payload: { saleNum: 2 } },
    { reportDate: "2026-10-05", msku: "SKU,SKU-2", payload: { saleNum: 6 } },
    { reportDate: "2026-10-06", msku: "SKU", payload: { saleNum: true } },
  ], "SKU");
  assert.deepEqual(rows, [{ date: "2026-10-01", units: 0 }]);
});
