import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays, rangeForPreset, replicaPages, shanghaiToday } from "@/lib/sellfox/replica-pages";

test("six sellfox replica routes keep data and stub split", () => {
  assert.deepEqual(replicaPages.map((page) => page.id), ["sales", "performance", "listings", "orders", "shipments", "restock"]);
  assert.deepEqual(replicaPages.map((page) => page.href), ["/sellfox/sales", "/sellfox/performance", "/sellfox/listings", "/sellfox/orders", "/sellfox/shipments", "/sellfox/restock"]);
  assert.equal(replicaPages.find((page) => page.id === "sales")?.endpoint, "/api/sellfox/sales");
  assert.equal(replicaPages.find((page) => page.id === "performance")?.endpoint, "/api/sellfox/performance");
  assert.equal(replicaPages.find((page) => page.id === "listings")?.endpoint, "/api/sellfox/listings");
  assert.equal(replicaPages.find((page) => page.id === "sales")?.stub, false);
  for (const id of ["orders", "shipments", "restock"]) {
    const page = replicaPages.find((item) => item.id === id);
    assert.equal(page?.stub, true);
    assert.equal(page?.emptyTitle, "暂无数据");
    assert.equal(page?.emptyHint, "待接赛狐");
  }
  const sales = replicaPages.find((page) => page.id === "sales");
  assert.deepEqual(sales?.dimensions.filter((item) => !item.disabled).map((item) => item.label), ["ASIN", "父ASIN", "MSKU", "SKU", "SPU", "店铺", "开发员"]);
  assert.equal(sales?.dimensions.find((item) => item.label === "业务员")?.disabled, true);
  assert.ok(sales?.columns.some((column) => column.label === "FBA可售"));
  assert.ok(sales?.columns.some((column) => column.label === "MSKU/售价"));
  assert.ok(replicaPages.find((page) => page.id === "orders")?.columns.some((column) => column.label === "订单号"));
  assert.ok(replicaPages.find((page) => page.id === "performance")?.columns.some((column) => column.label === "毛利润"));
});

test("date presets stay on the Asia/Shanghai calendar", () => {
  assert.equal(addCalendarDays("2026-11-06", -29), "2026-10-08");
  assert.deepEqual(rangeForPreset("d30", "2026-11-06"), { from: "2026-10-08", to: "2026-11-06" });
  assert.deepEqual(rangeForPreset("lastMonth", "2026-11-06"), { from: "2026-10-01", to: "2026-10-31" });
  assert.match(shanghaiToday(), /^\d{4}-\d{2}-\d{2}$/);
});
