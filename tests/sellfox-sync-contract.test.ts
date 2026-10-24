import test from "node:test";
import assert from "node:assert/strict";
import { isSellfoxDate, isSellfoxSyncResource, nextSellfoxPage } from "@/lib/sellfox/sync-contract";

test("Sellfox sync resource contract accepts the stable domains only", () => {
  for (const resource of ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report"]) {
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

test("page checkpoints stop at short pages, reported end, or the hard page bound", () => {
  assert.equal(nextSellfoxPage(100, 1, 4), 2);
  assert.equal(nextSellfoxPage(100, 4, 4), null);
  assert.equal(nextSellfoxPage(99, 1, null), null);
  assert.equal(nextSellfoxPage(100, 10_000, null), null);
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

test("unverified snapshot resources remain unavailable for sync while legacy domains stay supported", async () => {
  const { sellfoxSyncDisabledReason } = await import("@/lib/sellfox/sync-contract");
  for (const domain of ["inventory", "sales", "listings"]) assert.match(sellfoxSyncDisabledReason(domain) ?? "", /成功响应契约待验证/);
  for (const domain of ["stores", "performance", "hourly"]) assert.equal(sellfoxSyncDisabledReason(domain), null);
  assert.match(sellfoxSyncDisabledReason("ads_report") ?? "", /尚未接入/);
});
