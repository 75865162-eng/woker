import test from "node:test";
import assert from "node:assert/strict";
import { automaticBackfillDays, automaticBackfillStart, automaticIntervalMinutes, automaticMarketplaces, automaticPlanId, automaticPlanKey, isAutomaticResource, nextSalesTrafficRange } from "@/lib/amazon-sync/automatic-schedule";

const now = new Date("2026-11-05T12:00:00.000Z");

test("automatic plan scope is limited to the requested US and Canada domains", () => {
  assert.deepEqual([...automaticMarketplaces].sort(), ["A2EUQ1WTGCTBG2", "ATVPDKIKX0DER"]);
  assert.deepEqual(["catalog", "inventory", "orders", "sales_traffic", "finance", "returns"].filter(isAutomaticResource), ["catalog", "inventory", "orders", "sales_traffic", "finance"]);
  assert.equal(automaticIntervalMinutes, 1440);
  assert.equal(automaticBackfillDays, 730);
  assert.equal(automaticBackfillStart(now), "2024-11-05T12:00:00.000Z");
  assert.equal(automaticPlanId("source-a"), automaticPlanId("source-a"));
  assert.notEqual(automaticPlanKey("source-a"), automaticPlanKey("source-b"));
});

test("sales traffic backfill advances in inclusive windows of at most 31 days", () => {
  const first = nextSalesTrafficRange("ATVPDKIKX0DER", now, []);
  assert.equal(first.range.from, "2024-11-05");
  assert.equal(first.range.to, "2024-12-05");
  assert.equal(first.backfill, true);

  const second = nextSalesTrafficRange("ATVPDKIKX0DER", now, [{ from: first.range.from, to: first.range.to }]);
  assert.equal(second.range.from, "2024-12-06");
  assert.equal(second.range.to, "2025-01-05");
  assert.equal(Date.parse(`${second.range.to}T00:00:00Z`) - Date.parse(`${second.range.from}T00:00:00Z`), 30 * 86_400_000);
  assert.equal(second.backfill, true);
});

test("sales traffic daily schedule returns yesterday after the 730-day history is covered", () => {
  const covered = nextSalesTrafficRange("A2EUQ1WTGCTBG2", now, [{ from: "2024-11-05", to: "2026-11-04" }]);
  assert.equal(covered.range.from, "2026-11-04");
  assert.equal(covered.range.to, "2026-11-04");
  assert.equal(covered.backfill, false);
});
