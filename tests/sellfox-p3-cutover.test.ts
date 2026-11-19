import assert from "node:assert/strict";
import test from "node:test";
import {
  ttlWithJitter, SELLFOX_TTL_JITTER_RATIO, setSellfoxTtlRandomForTest,
} from "../src/lib/sellfox/result-cache";
import {
  PROFIT_AGG_FIELDS, ADS_AGG_FIELDS, OVERVIEW_AGG_FIELDS,
  reconcileProfitAggDaily, reconcileAdsAggDaily, reconcileOverviewAgg,
} from "../src/lib/sellfox/aggregate-reconcile";
import {
  decideAggregateRead, readAggregateOrLive,
} from "../src/lib/sellfox/aggregate-read-gate";

// ---------- TTL jitter (cache avalanche protection) ----------

test("ttlWithJitter stays within ±ratio and clamps to >=1s", () => {
  assert.equal(ttlWithJitter(300, () => 0, 0.1), 270);
  assert.equal(ttlWithJitter(300, () => 1, 0.1), 330);
  assert.equal(ttlWithJitter(300, () => 0.5, 0.1), 300);
  // clamp: a very small base must never round to 0
  assert.equal(ttlWithJitter(1, () => 0, 0.5), 1);
  assert.equal(SELLFOX_TTL_JITTER_RATIO, 0.1);
});

test("ttlWithJitter tolerates invalid input without throwing", () => {
  assert.equal(ttlWithJitter(0, () => 0.5), 0);
  assert.equal(ttlWithJitter(Number.NaN, () => 0.5), Number.NaN);
});

test("setSellfoxTtlRandomForTest accepts undefined to restore default", () => {
  setSellfoxTtlRandomForTest(undefined);
  const v = ttlWithJitter(300, () => 0.5); // direct call still deterministic
  assert.equal(v, 300);
});

// ---------- reconciliation for the 3 remaining idle aggregate tables ----------

const scope = { organizationId: "o", workspaceId: "w", from: "2026-11-18", to: "2026-11-19" };

test("reconcileProfitAggDaily reports ok on equal rows and diff on padded money", async () => {
  const row = {
    storeId: "s", msku: "m", reportDate: "2026-11-18", onlySettle: false,
    saleQuantity: 3, saleRevenue: "10.0000", grossProfit: "2.0000",
    netRevenue: "9.0000", adCost: "1.0000", currency: "USD",
  };
  const calls: string[] = [];
  const query = async (sql: string) => { calls.push(sql); return { rows: [row] }; };
  const ok = await reconcileProfitAggDaily(query, scope);
  assert.equal(ok.ok, true);
  assert.equal(ok.diffs.length, 0);
  assert.equal(calls.length, 2);

  // aggregate pads a NULL grossProfit with 0 -> must be flagged
  let n = 0;
  const query2 = async () => {
    n += 1;
    return { rows: [n === 1 ? row : { ...row, grossProfit: "0" }] };
  };
  const bad = await reconcileProfitAggDaily(query2, scope);
  assert.equal(bad.ok, false);
  assert.ok(bad.diffs[0].fields.some((f) => f.field === "grossProfit" && f.aggregate === "0"));
});

test("reconcileAdsAggDaily uses null-sentinel keys so campaign/product rows align", async () => {
  const row = {
    storeId: "s", reportDate: "2026-11-18", adType: "SP", campaignId: "c",
    adGroupId: null, targetingId: null, entityType: "campaign",
    impressions: 10, clicks: 2, cost: "3.0000", adOrders: 1, adSales: "12.0000", currency: "USD",
  };
  const query = async () => ({ rows: [row] });
  const ok = await reconcileAdsAggDaily(query, scope);
  assert.equal(ok.ok, true, "identical NULL-bearing rows must reconcile with sentinel keys");
});

test("reconcileOverviewAgg compares the single workspace rollup", async () => {
  const row = { storeCount: 39, inventoryCount: 8839, latestSalesDate: "2026-11-18", latestProfitDate: "2026-11-18" };
  const query = async () => ({ rows: [row] });
  const ok = await reconcileOverviewAgg(query, scope);
  assert.equal(ok.ok, true);
  assert.deepEqual(OVERVIEW_AGG_FIELDS, ["storeCount", "inventoryCount", "latestSalesDate", "latestProfitDate"]);
  assert.ok(PROFIT_AGG_FIELDS.includes("adCost"));
  assert.ok(ADS_AGG_FIELDS.includes("adSales"));
});

// ---------- reconciliation-gated cutover ----------

test("decideAggregateRead gates on switch, reconciliation and row presence", () => {
  assert.deepEqual(decideAggregateRead({ switchEnabled: false, reconcileOk: true, aggregateHasRows: true }), { useAggregate: false, reason: "disabled" });
  assert.deepEqual(decideAggregateRead({ switchEnabled: true, reconcileOk: null, aggregateHasRows: true }), { useAggregate: false, reason: "no-report" });
  assert.deepEqual(decideAggregateRead({ switchEnabled: true, reconcileOk: false, aggregateHasRows: true }), { useAggregate: false, reason: "not-reconciled" });
  assert.deepEqual(decideAggregateRead({ switchEnabled: true, reconcileOk: true, aggregateHasRows: false }), { useAggregate: false, reason: "aggregate-empty" });
  assert.deepEqual(decideAggregateRead({ switchEnabled: true, reconcileOk: true, aggregateHasRows: true }), { useAggregate: true, reason: "ok" });
});

test("readAggregateOrLive serves aggregate only when fully gated", async () => {
  const gated = await readAggregateOrLive({
    reconcileOk: true,
    loadAggregate: async () => ({ total: 42 }),
    loadLive: async () => ({ total: 42 }),
    switchEnabled: true,
  });
  assert.equal(gated.source, "aggregate");
  assert.equal(gated.body.total, 42);
});

test("readAggregateOrLive falls back to live when switch off (tables may be empty)", async () => {
  let liveCalls = 0;
  const gated = await readAggregateOrLive({
    reconcileOk: true,
    loadAggregate: async () => { throw new Error("should not be called"); },
    loadLive: async () => { liveCalls += 1; return { total: 7 }; },
    switchEnabled: false,
  });
  assert.equal(gated.source, "live");
  assert.equal(gated.decision.reason, "disabled");
  assert.equal(liveCalls, 1);
});

test("readAggregateOrLive falls back to live on empty aggregate or reconcile failure", async () => {
  const empty = await readAggregateOrLive<string[]>({
    reconcileOk: true,
    loadAggregate: async () => [],
    loadLive: async () => ["live-body"],
    isEmpty: (v) => v.length === 0,
    switchEnabled: true,
  });
  assert.equal(empty.source, "live");
  assert.equal(empty.decision.reason, "aggregate-empty");

  const notReconciled = await readAggregateOrLive({
    reconcileOk: false,
    loadAggregate: async () => "agg",
    loadLive: async () => "live-body",
    switchEnabled: true,
  });
  assert.equal(notReconciled.source, "live");
  assert.equal(notReconciled.decision.reason, "not-reconciled");
});

test("readAggregateOrLive never surfaces an aggregate-read error", async () => {
  const gated = await readAggregateOrLive({
    reconcileOk: true,
    loadAggregate: async () => { throw new Error("redis/pg blip"); },
    loadLive: async () => "ok-live",
    switchEnabled: true,
  });
  assert.equal(gated.body, "ok-live");
  assert.equal(gated.source, "live");
});
