import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDisposition,
  buildReturnAttribution,
  buildReturnAttributionSummary,
  type ReturnLineInput,
} from "../src/lib/amazon-sync/return-analytics";

const line = (over: Partial<ReturnLineInput> = {}): ReturnLineInput => ({
  marketplaceId: "ATVPDKIKX0DER", sellerSku: "SKU-1", asin: "B0TEST",
  amazonOrderId: "O-1", quantity: 1, disposition: null, reasonCode: null, ...over,
});

test("退货归因：disposition 按关键字归四类，不改写原值", () => {
  assert.equal(classifyDisposition("Sellable"), "sellable");
  assert.equal(classifyDisposition("Used - Like New"), "sellable");
  assert.equal(classifyDisposition("Defective"), "defective");
  assert.equal(classifyDisposition("Damaged"), "defective");
  assert.equal(classifyDisposition("Unsellable"), "unsellable");
  assert.equal(classifyDisposition(null), "other");
  assert.equal(classifyDisposition("Customer changed mind"), "other");
});

test("退货归因：按站点+SKU 聚合件数、distinct 订单数、质量分类、退货率", () => {
  const rows = buildReturnAttribution([
    line({ disposition: "Defective", quantity: 2, amazonOrderId: "O-1" }),
    line({ disposition: "Sellable", quantity: 1, amazonOrderId: "O-1" }),
    line({ disposition: "Damaged", quantity: 1, amazonOrderId: "O-2" }),
  ], new Map([["ATVPDKIKX0DER\u0000SKU-1", 100]]), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].returnUnits, 4);
  assert.equal(rows[0].returnOrders, 2);
  assert.equal(rows[0].soldUnits, 100);
  assert.equal(rows[0].returnRate, "0.04");
  assert.equal(rows[0].defective, 3);
  assert.equal(rows[0].sellable, 1);
});

test("退货归因：无销量数据或分母 0 时退货率为 null，不补零", () => {
  const none = buildReturnAttribution([line({ quantity: 3 })], new Map(), false);
  assert.equal(none[0].soldUnits, null);
  assert.equal(none[0].returnRate, null);
  const zero = buildReturnAttribution([line()], new Map([["ATVPDKIKX0DER\u0000SKU-1", 0]]), true);
  assert.equal(zero[0].returnRate, null);
});

test("退货归因：不同站点/SKU 分列不混算", () => {
  const rows = buildReturnAttribution([
    line({ marketplaceId: "A", sellerSku: "X" }),
    line({ marketplaceId: "A", sellerSku: "Y" }),
    line({ marketplaceId: "B", sellerSku: "X" }),
  ], new Map(), false);
  assert.equal(rows.length, 3);
});

test("退货归因：汇总总退货率按总件数/总销量，订单数全局 distinct", () => {
  const rows = buildReturnAttribution([
    line({ sellerSku: "X", amazonOrderId: "O-1", quantity: 2, disposition: "Defective" }),
    line({ sellerSku: "Y", amazonOrderId: "O-1", quantity: 3, disposition: "Sellable" }),
    line({ sellerSku: "X", amazonOrderId: "O-2", quantity: 5, disposition: "Unsellable" }),
  ], new Map([["ATVPDKIKX0DER\u0000X", 100], ["ATVPDKIKX0DER\u0000Y", 50]]), true);
  const summary = buildReturnAttributionSummary(rows, new Set(["O-1", "O-2"]));
  assert.equal(summary.returnUnits, 10);
  assert.equal(summary.returnOrders, 2);
  assert.equal(summary.soldUnits, 150);
  assert.equal(summary.returnRate, "0.066667");
  assert.equal(summary.defective, 2);
  assert.equal(summary.sellable, 3);
  assert.equal(summary.unsellable, 5);
});
