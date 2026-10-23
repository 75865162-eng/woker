import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyMetricsWhere, buildInventorySnapshotWhere, parseDailyMetricsFilters, parseInventorySnapshotFilters, toDailyMetric } from "@/lib/operations/read-models";

test("daily metrics filters validate and bound date range, pagination, and identifiers", () => {
  const now = new Date("2026-10-22T08:00:00.000Z");
  const filters = parseDailyMetricsFilters(new URLSearchParams({
    from: "2026-10-01",
    to: "2026-10-22",
    sku: " SKU-1 ",
    asin: "B000000001",
    page: "3",
    pageSize: "500",
  }), now);

  assert.deepEqual(filters, { from: "2026-10-01", to: "2026-10-22", sku: "SKU-1", asin: "B000000001", page: 3, pageSize: 200 });
  assert.equal(parseDailyMetricsFilters(new URLSearchParams({ from: "2026-01-01", to: "2026-10-22" }), now), null);
  assert.equal(parseDailyMetricsFilters(new URLSearchParams({ from: "2026-02-31", to: "2026-03-01" }), now), null);
});

test("inventory snapshot filters default and clamp pagination without losing SKU input", () => {
  assert.deepEqual(parseInventorySnapshotFilters(new URLSearchParams({ page: "0", pageSize: "999", sku: " SKU-2 " })), {
    page: 1,
    pageSize: 200,
    sku: "SKU-2",
  });
});

test("read query builders always constrain organization and workspace", () => {
  const filters = parseDailyMetricsFilters(new URLSearchParams({ from: "2026-10-21", to: "2026-10-22", sku: "SKU-1", asin: "B000000001" }), new Date("2026-10-22T08:00:00.000Z"));
  assert.ok(filters);
  assert.deepEqual(buildInventorySnapshotWhere({ organizationId: "org-a", workspaceId: "ws-a", syncRunId: "run-a", sku: "SKU-1" }), {
    organizationId: "org-a",
    workspaceId: "ws-a",
    syncRunId: "run-a",
    sellerSku: { contains: "SKU-1", mode: "insensitive" },
  });
  assert.deepEqual(buildDailyMetricsWhere({ organizationId: "org-a", workspaceId: "ws-a", filters }), {
    organizationId: "org-a",
    workspaceId: "ws-a",
    reportDate: { gte: "2026-10-21", lte: "2026-10-22" },
    sku: { contains: "SKU-1", mode: "insensitive" },
    asin: { equals: "B000000001", mode: "insensitive" },
  });
});

test("daily metrics keep missing sales and TACOS null instead of manufacturing zero", () => {
  const metric = toDailyMetric({
    reportDate: "2026-10-21",
    sku: "SKU-1",
    asin: "B000000001",
    currency: "USD",
    _sum: { saleRevenue: 0, adCost: 12.5, saleQuantity: 0 },
  });

  assert.equal(metric.sales, null);
  assert.equal(metric.adSpend, 12.5);
  assert.equal(metric.tacos, null);
  assert.match(metric.fieldNotes.sales ?? "", /返回 null/);
  assert.match(metric.fieldNotes.tacos ?? "", /无法计算/);
});

test("daily TACOS is a percentage of existing report sales", () => {
  const metric = toDailyMetric({
    reportDate: "2026-10-21",
    sku: "SKU-1",
    asin: "B000000001",
    currency: "USD",
    _sum: { saleRevenue: 100, adCost: 7.5, saleQuantity: 2 },
  });

  assert.equal(metric.sales, 100);
  assert.equal(metric.adSpend, 7.5);
  assert.equal(metric.tacos, 7.5);
});
