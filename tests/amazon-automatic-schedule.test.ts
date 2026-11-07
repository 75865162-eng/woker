import test from "node:test";
import assert from "node:assert/strict";
import { automaticBackfillDays, automaticBackfillStart, automaticIntervalMinutes, automaticMarketplaces, automaticPlanId, automaticPlanKey, isAutomaticResource, nextSalesTrafficRange, nextAutomaticReimbursementWindow } from "@/lib/amazon-sync/automatic-schedule";

const now = new Date("2026-11-05T12:00:00.000Z");

test("reimbursement history advances in 30 closed days and never overwrites a pending window", () => {
  const first = nextAutomaticReimbursementWindow(now);
  assert.equal(first.from, "2024-11-05");
  assert.equal(first.to, "2024-12-04");
  const cursor = { watermarkFrom: new Date(first.dataStartTime), watermarkTo: new Date(first.dataEndTime), status: "FAILED" };
  assert.deepEqual(nextAutomaticReimbursementWindow(now, cursor), first);
  assert.equal(nextAutomaticReimbursementWindow(now, { ...cursor, status: "SUCCEEDED" }).from, "2024-12-05");
  assert.throws(() => nextAutomaticReimbursementWindow(now, { ...cursor, watermarkTo: cursor.watermarkFrom }));
});

test("automatic plan scope includes verified reporting marketplaces and executable source policies", () => {
  for (const site of ["A1AM78C64UM0Y8", "A2EUQ1WTGCTBG2", "A2Q3Y263D00KWC", "ATVPDKIKX0DER", "A1PA6795UKMFR9", "A1VC38T7YXB528"]) assert.equal(automaticMarketplaces.has(site), true);
  assert.equal(automaticMarketplaces.has("AHRY1CZE9ZY4H"), false);
  assert.deepEqual(["catalog", "inventory", "orders", "sales_traffic", "finance", "returns", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics"].filter(isAutomaticResource), ["catalog", "inventory", "orders", "sales_traffic", "finance", "returns", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics"]);
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

test("automatic resume is immediate and task keys isolate configuration revisions", async () => {
  const { automaticTaskKey, nextPlanRunAt } = await import('@/lib/amazon-sync/automatic-schedule');
  assert.equal(nextPlanRunAt(true, true, 1440, now)?.toISOString(), now.toISOString());
  assert.equal(nextPlanRunAt(false, true, 1440, now), null);
  assert.equal(nextPlanRunAt(true, false, 60, now)?.getTime(), now.getTime()+3600000);
  const plan={id:'plan',revision:1}, source={revision:1,authorization:{revision:2}};
  const key=automaticTaskKey(plan,source,'from','to');
  assert.equal(key,automaticTaskKey(plan,source,'from','to'));
  assert.notEqual(key,automaticTaskKey({...plan,revision:2},source,'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,{...source,revision:2},'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,{...source,authorization:{revision:3}},'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,source,'from','other'));
  assert.ok(key.length<=160);
});


test("completed incremental cursors survive automatic plan adoption and reimbursement starts at retention", async () => {
  const { nextOrderWindow, parseOrderSyncPolicy } = await import("@/lib/amazon-sync/orders");
  const policy = parseOrderSyncPolicy({ initialFrom: automaticBackfillStart(now), windowMinutes: 1440, overlapSeconds: 60, safetyLagSeconds: 180, marketplaceTimeZone: "America/Los_Angeles", applicationId: "fixture", requestsPerSecond: .0056, burst: 1, statusMapping: {} });
  const cursor = { watermarkFrom: new Date("2026-10-01T00:00:00Z"), watermarkTo: new Date("2026-10-02T00:00:00Z"), status: "SUCCEEDED" };
  assert.equal(nextOrderWindow(policy, cursor, now).from, "2026-10-01T23:59:00.000Z");
  assert.equal(nextAutomaticReimbursementWindow(now).from, "2024-11-05");
});
