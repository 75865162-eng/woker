import test from "node:test";
import assert from "node:assert/strict";
import { isSellfoxDate, isSellfoxSyncResource, nextSellfoxPage, normalizeSellfoxDates, sellfoxReportDates } from "@/lib/sellfox/sync-contract";

test("Sellfox sync resource contract accepts the stable domains only", () => {
  for (const resource of ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
    assert.equal(isSellfoxSyncResource(resource), true);
  }
  assert.equal(isSellfoxSyncResource("products"), false);
  assert.equal(isSellfoxSyncResource(null), false);
});

test("Sellfox dates reject normalized invalid calendar days", () => {
  assert.equal(isSellfoxDate("2024-02-29"), true);
  assert.equal(isSellfoxDate("2026-02-29"), false);
  assert.equal(isSellfoxDate("2026-10-24"), true);
  assert.equal(isSellfoxDate("2026-1-04"), false);
});

test("page checkpoints stop only at a complete end and reject truncated responses", () => {
  assert.equal(nextSellfoxPage(100, 1, 4), 2);
  assert.equal(nextSellfoxPage(100, 4, 4), null);
  assert.equal(nextSellfoxPage(99, 1, null), null);
  assert.throws(() => nextSellfoxPage(100, 10_000, null), /安全上限/);
  assert.throws(() => nextSellfoxPage(0, 1, 4), /响应不完整/);
});

test("FBA requests use the documented single-store list and retain zero/deleted/unmerged rows", async () => {
  const { sellfoxInventoryRequest } = await import("@/lib/sellfox/sync-requests");
  assert.deepEqual(sellfoxInventoryRequest("shop-a", 2), {
    shopIdList: ["shop-a"], pageNo: "2", pageSize: "100", hideZero: "false", hideDeletedPrd: "false", needMergeShare: "false",
  });
  assert.throws(() => sellfoxInventoryRequest("", 1));
  assert.throws(() => sellfoxInventoryRequest("shop-a", 0));
});

test("daily sales requests specify MSKU dimension and distinct volume/revenue metrics", async () => {
  const { sellfoxSalesRequest } = await import("@/lib/sellfox/sync-requests");
  for (const metric of ["productNum", "salePrice"] as const) {
    assert.deepEqual(sellfoxSalesRequest("shop-a", "2026-10-24", 1, metric), {
      shopIdList: ["shop-a"], pageNo: "1", pageSize: "100", type: metric,
      groupType: "msku", statTimeType: 1, startDate: "2026-10-24", endDate: "2026-10-24", currency: "",
    });
  }
  assert.throws(() => sellfoxSalesRequest("shop-a", "2026-02-29", 1, "productNum"));
});

test("verified listing and product report contracts enable the stable read-only resources", async () => {
  const { sellfoxSyncDisabledReason } = await import("@/lib/sellfox/sync-contract");
  for (const domain of ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) assert.equal(sellfoxSyncDisabledReason(domain), null);
});


test("report dates normalize once in Shanghai and reject conflicting or oversized ranges", () => {
  const beforeMidnight = new Date("2026-10-24T15:59:59Z");
  const frozen = normalizeSellfoxDates("performance", {}, beforeMidnight);
  assert.deepEqual(frozen, { startDate: "2026-10-23", endDate: "2026-10-23" });
  assert.deepEqual(normalizeSellfoxDates("performance", frozen, new Date("2026-10-26T00:00:00Z")), frozen);
  assert.deepEqual(normalizeSellfoxDates("sales", { endDate: "2024-02-29" }), { startDate: "2024-02-29", endDate: "2024-02-29" });
  assert.equal(sellfoxReportDates("2026-01-01", "2026-03-31").length, 90);
  assert.throws(() => normalizeSellfoxDates("sales", { dateRange: { from: "2026-01-01", to: "2026-04-01" } }), /90/);
  assert.throws(() => sellfoxReportDates("2026-01-01", "2026-04-01"), /90/);
  assert.throws(() => normalizeSellfoxDates("sales", { reportDate: "2026-02-29" }), /有效/);
  assert.throws(() => normalizeSellfoxDates("performance", { reportDate: "2026-10-24", startDate: "2026-10-24" }), /不能/);
  assert.throws(() => normalizeSellfoxDates("sales", { dateRange: {}, startDate: "2026-10-24" }), /dateRange/);
  assert.throws(() => normalizeSellfoxDates("sales", { dateRange: {} }), /不能为空/);
  assert.throws(() => sellfoxReportDates("2026-10-25", "2026-10-24"), /90/);
});

test("current-state capture forbids backdating and hourly samples enforce the 60-day window", () => {
  const now = new Date("2026-10-24T16:01:00Z");
  assert.deepEqual(normalizeSellfoxDates("inventory", {}, now), { reportDate: "2026-10-25" });
  for (const resource of ["inventory", "listings"] as const) {
    assert.throws(() => normalizeSellfoxDates(resource, { reportDate: "2026-10-24" }, now), /当前状态/);
    assert.throws(() => normalizeSellfoxDates(resource, { startDate: "2026-10-25" }, now), /当前状态/);
  }
  assert.deepEqual(normalizeSellfoxDates("hourly", { reportDate: "2026-08-27" }, now), { reportDate: "2026-08-27" });
  for (const reportDate of ["2026-08-26", "2026-10-26"]) assert.throws(() => normalizeSellfoxDates("hourly", { reportDate }, now), /60/);
});
