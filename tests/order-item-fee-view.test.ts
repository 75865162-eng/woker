import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderItemFeeView, buildOrderItemFeeViews } from "../src/lib/amazon-sync/order-item-fee-view";

test("buildOrderItemFeeView: 从原始行 Json 提取 7 项订单行费用，缺值保持 null", () => {
  const view = buildOrderItemFeeView({
    "ItemTax": "1.25",
    "shipping_tax": "0.30",
    "PromotionDiscount": "2.00",
    "ShippingPrice": "3.50",
    "GiftWrapPrice": "",
    "PointsGranted": "10",
    // ConditionNote 未提供
  });
  assert.equal(view.fees.itemTax, "1.25");
  assert.equal(view.fees.shippingTax, "0.30");
  assert.equal(view.fees.promotionDiscount, "2.00");
  assert.equal(view.fees.shippingAmount, "3.50");
  assert.equal(view.fees.giftWrapPrice, null, "源端显式空值 → null，不补 0");
  assert.equal(view.fees.pointsGranted, "10");
  assert.equal(view.fees.conditionNote, null, "未提供的字段 → null");
  assert.equal(view.evidence.giftWrapPrice.explicitlyEmpty, true);
  assert.equal(view.evidence.itemTax.matchedKey, "ItemTax");
});

test("覆盖率审计：命中的才算提取，显式空值仍算命中（源报告提供了该列）", () => {
  const view = buildOrderItemFeeView({
    ItemTax: "1", shipping_tax: "0", PromotionDiscount: "2",
    ShippingPrice: "3", GiftWrapPrice: "", PointsGranted: "5", ConditionNote: "used",
  });
  assert.equal(view.coverage.extracted, 7);
  assert.equal(view.coverage.total, 7);
  assert.equal(view.coverage.ratio, 1);
  assert.deepEqual(view.missing, []);
});

test("空/无效输入：全部 null，覆盖率 0，missing 全部 prop，绝不臆造", () => {
  for (const input of [null, undefined, {}, "not-object" as unknown as Record<string, unknown>]) {
    const view = buildOrderItemFeeView(input);
    assert.equal(view.coverage.extracted, 0);
    assert.equal(view.coverage.ratio, 0);
    assert.equal(view.missing.length, 7);
    assert.ok(Object.values(view.fees).every((v) => v === null));
  }
});

test("多别名与归一化匹配：下划线/大小写差异均可命中", () => {
  const view = buildOrderItemFeeView({ "item_tax": "9.9", "shippingprice": "1.1" });
  assert.equal(view.fees.itemTax, "9.9");
  assert.equal(view.fees.shippingAmount, "1.1");
  assert.equal(view.evidence.itemTax.matchedKey, "item_tax");
});

test("批量视图保持顺序与逐行隔离", () => {
  const views = buildOrderItemFeeViews([
    { key: "row-1", fields: { ItemTax: "1" } },
    { key: "row-2", fields: { ItemTax: "2", PromotionDiscount: "3" } },
  ]);
  assert.deepEqual(views.map((v) => v.key), ["row-1", "row-2"]);
  assert.equal(views[0].view.fees.itemTax, "1");
  assert.equal(views[0].view.fees.promotionDiscount, null, "行1 不串到行2 的值");
  assert.equal(views[1].view.fees.promotionDiscount, "3");
});
