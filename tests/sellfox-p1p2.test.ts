import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateStatementsFor, aggId, salesAggDailyStatement, profitAggDailyStatement,
  adsAggDailyStatement, overviewAggStatement, inventoryAggStatement, refreshSellfoxAggregates,
} from "../src/lib/sellfox/agg-refresh";
import {
  compareAggregateRows, reconcileSalesAggDaily, assertReconciled, SALES_AGG_FIELDS, INVENTORY_AGG_FIELDS,
} from "../src/lib/sellfox/aggregate-reconcile";
import { listingProfileColumnList, listingProfileRefreshStatements } from "../src/lib/sellfox/listing-profile-refresh";

const base = {
  organizationId: "org1", workspaceId: "ws1", resource: "sales",
  shopExternalIds: ["shop-a"], reportDate: "2026-11-18", runId: "run1",
};

test("aggId is deterministic and encodes null as sentinel", () => {
  assert.equal(aggId("a", 1, true), "a|1|true");
  assert.equal(aggId("a", null, undefined), "a|~|~");
  assert.equal(aggId("a", 1), aggId("a", 1));
});

test("aggregate statement dispatch follows resource and keeps NULL-preserving SUM", () => {
  const sales = aggregateStatementsFor(base);
  assert.deepEqual(sales.map((s) => s.name), ["sales_daily", "overview"]);

  const profit = aggregateStatementsFor({ ...base, resource: "performance" });
  assert.deepEqual(profit.map((s) => s.name), ["profit_daily", "overview"]);

  const ads = aggregateStatementsFor({ ...base, resource: "ads_report" });
  assert.deepEqual(ads.map((s) => s.name), ["ads_daily", "overview"]);

  // inventory sync refreshes both the current-state aggregate and the overview rollup.
  const inventory = aggregateStatementsFor({ ...base, resource: "inventory" });
  assert.deepEqual(inventory.map((s) => s.name), ["inventory_current", "overview"]);

  // A non-fact resource only refreshes the cheap overview rollup.
  const orders = aggregateStatementsFor({ ...base, resource: "orders" });
  assert.deepEqual(orders.map((s) => s.name), []);

  const sql = salesAggDailyStatement(base)!;
  const text = String(sql.text);
  assert.match(text, /CASE WHEN count\(t\."revenue"\)=count\(\*\) THEN SUM\(t\."revenue"\) END/);
  assert.match(text, /ON CONFLICT/);
  assert.match(text, /SellfoxSalesAggDaily/);
});

test("statements require a date window and return null otherwise", () => {
  assert.equal(salesAggDailyStatement({ ...base, reportDate: undefined, startDate: undefined, endDate: undefined }), null);
  assert.equal(profitAggDailyStatement({ ...base, reportDate: undefined }), null);
  assert.equal(adsAggDailyStatement({ ...base, reportDate: undefined }), null);
  assert.ok(overviewAggStatement(base));
  // inventory is a current-state rollup — it does not need a date window.
  assert.ok(inventoryAggStatement(base));
});

test("agg statements are tenant-scoped and never write Amazon tables", () => {
  const all = [salesAggDailyStatement(base), profitAggDailyStatement({ ...base, resource: "performance" }), adsAggDailyStatement({ ...base, resource: "ads_report" }), inventoryAggStatement(base), overviewAggStatement(base)];
  for (const stmt of all) {
    const text = String(stmt!.text).toLowerCase();
    assert.ok(text.includes("organizationid") && text.includes("workspaceid"), "must carry tenant scope");
    assert.ok(!text.includes("amazon"), "must not touch Amazon data");
  }
});

test("inventory aggregate statement uses the current-state view and NULL-preserving SUM", () => {
  const text = String(inventoryAggStatement(base)!.text);
  assert.match(text, /sellfox_inventory_current/);
  assert.match(text, /CASE WHEN count\(i\."quantity"\)=count\(\*\) THEN SUM\(i\."quantity"\)::int END/);
  assert.match(text, /count\(\*\)::int, max\(i\."capturedAt"\)/);
  assert.match(text, /ON CONFLICT \("organizationId","workspaceId","storeId","msku"\)/);
  assert.match(text, /SellfoxInventoryAgg/);
  assert.deepEqual(INVENTORY_AGG_FIELDS.includes("warehouseCount"), true);
});

test("refreshSellfoxAggregates executes exactly the dispatched statements via injected writer", async () => {
  const executed: string[] = [];
  const db = { $executeRaw: async (sql: { text: string }) => { executed.push(sql.text); return 0; } };
  const result = await refreshSellfoxAggregates(base, db as never);
  assert.deepEqual(result.refreshed, ["sales_daily", "overview"]);
  assert.equal(executed.length, 2);
});

test("compareAggregateRows detects per-field diffs and treats both-null as equal", () => {
  const source = [
    { key: "a|2026-11-18", quantity: 5, orders: 2, revenueOriginal: "10.5000", currencyOriginal: "USD", complete: true },
    { key: "b|2026-11-18", quantity: null, orders: null, revenueOriginal: null, currencyOriginal: null, complete: null },
  ];
  const good = [
    { key: "a|2026-11-18", quantity: 5, orders: 2, revenueOriginal: "10.5000", currencyOriginal: "USD", complete: true },
    { key: "b|2026-11-18", quantity: null, orders: null, revenueOriginal: null, currencyOriginal: null, complete: null },
  ];
  assert.deepEqual(compareAggregateRows(source, good, SALES_AGG_FIELDS, (r) => String(r.key)), []);

  // aggregate padded missing revenue with 0 -> must be flagged (no-zero-padding discipline)
  const padded = good.map((r) => r.key === "b|2026-11-18" ? { ...r, revenueOriginal: "0" } : r);
  const diffs = compareAggregateRows(source, padded, SALES_AGG_FIELDS, (r) => String(r.key));
  assert.equal(diffs.length, 1);
  assert.deepEqual(diffs[0].fields[0], { field: "revenueOriginal", source: null, aggregate: "0" });
});

test("assertReconciled throws on row-count mismatch or diffs", () => {
  assert.doesNotThrow(() => assertReconciled({ scope: { organizationId: "o", workspaceId: "w", from: "a", to: "b" }, sourceRows: 0, aggregateRows: 0, diffs: [], ok: true }));
  assert.throws(() => assertReconciled({ scope: { organizationId: "o", workspaceId: "w", from: "a", to: "b" }, sourceRows: 1, aggregateRows: 1, diffs: [{ key: "k", fields: [{ field: "quantity", source: "1", aggregate: "2" }] }], ok: false }), /对账未通过/);
});

test("reconcileSalesAggDaily uses injected query and reports ok on 0 diff", async () => {
  const calls: string[] = [];
  const query = async (sql: string) => { calls.push(sql); return { rows: calls.length === 1
    ? [{ storeId: "s", msku: "m", reportDate: "2026-11-18", quantity: 3, orders: 1, revenueOriginal: "8.0000", currencyOriginal: "USD", complete: true }]
    : [{ storeId: "s", msku: "m", reportDate: "2026-11-18", quantity: 3, orders: 1, revenueOriginal: "8.0000", currencyOriginal: "USD", complete: true }] }; };
  const report = await reconcileSalesAggDaily(query, { organizationId: "o", workspaceId: "w", from: "2026-11-18", to: "2026-11-18" });
  assert.equal(report.ok, true);
  assert.equal(report.diffs.length, 0);
  assert.equal(calls.length, 2);
});

test("listing profile projection columns align with the view (no dropped columns)", () => {
  const cols = listingProfileColumnList();
  for (const required of ["id", "organizationId", "workspaceId", "storeId", "sourceKey", "capturedAt", "asin", "productTagNames", "developer", "spu"]) {
    assert.ok(cols.includes(`"${required}"`), `missing ${required}`);
  }
});

test("listing profile refresh statements are tenant+store scoped", () => {
  const stmts = listingProfileRefreshStatements("o", "w", ["s1", "s2"]);
  assert.match(String(stmts.delete.text), /DELETE FROM "SellfoxListingProfile"/);
  assert.match(String(stmts.delete.text), /ANY/);
  assert.match(String(stmts.insert.text), /sellfox_listing_current/);
  assert.match(String(stmts.insert.text), /INSERT INTO "SellfoxListingProfile"/);
});
