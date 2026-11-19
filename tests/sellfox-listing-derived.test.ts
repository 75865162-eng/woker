import test from "node:test";
import assert from "node:assert/strict";
import {
  estimatedFee, grossProfit, grossProfitRate, profitRate, applyListingDerived,
} from "@/lib/sellfox/listing-derived";
import { columns, summableColumnKeys, visibleColumns } from "@/components/sellfox/workbench-types";

// Fixtures below are explicit TEST INPUTS for arithmetic verification.
// They are not real business data and are never used at runtime.

const complete = {
  price: 100,
  purchaseCost: 20,
  headTripCost: 5,
  fbaFees: 3,
  referralFee: 2,
  shippingPrice: 1,
  profitPrice: 40, // our口径
  profitRate: 0.4,
};

test("预计费用 = FBA费用 + 佣金 + 运费；任一因子缺失返回 null（禁止 COALESCE 0）", () => {
  assert.equal(estimatedFee(complete), 6);
  assert.equal(estimatedFee({ ...complete, fbaFees: null }), null);
  assert.equal(estimatedFee({ ...complete, referralFee: undefined }), null);
  assert.equal(estimatedFee({ ...complete, shippingPrice: "" }), null);
  assert.equal(estimatedFee({ fbaFees: 3, referralFee: 2 }), null);
});

test("毛利润（赛狐口径）= 售价 − (采购成本 + 头程 + 预计费用)；缺成本返回 null", () => {
  // 100 - (20 + 5 + 6) = 69
  assert.equal(grossProfit(complete), 69);
  // Missing cost must yield null, NOT price - 0 fees (which would fabricate profit).
  assert.equal(grossProfit({ ...complete, purchaseCost: null }), null);
  assert.equal(grossProfit({ ...complete, headTripCost: null }), null);
  assert.equal(grossProfit({ ...complete, price: null }), null);
  assert.equal(grossProfit({ ...complete, fbaFees: null }), null);
});

test("毛利率 = 毛利润 / 售价；售价 <= 0 或任一因子缺失返回 null", () => {
  assert.equal(grossProfitRate(complete), 0.69);
  assert.equal(grossProfitRate({ ...complete, price: 0 }), null);
  assert.equal(grossProfitRate({ ...complete, price: -10 }), null);
  assert.equal(grossProfitRate({ ...complete, purchaseCost: null }), null);
});

test("利润率（我方口径）用 profitPrice，与赛狐毛口径并存且互不覆盖", () => {
  assert.equal(profitRate(complete), 0.4);
  assert.equal(profitRate({ ...complete, profitPrice: null }), null);
  assert.equal(profitRate({ ...complete, price: 0 }), null);
});

test("applyListingDerived 写入三列但不改写 profitPrice/profitRate（两口径共存）", () => {
  const row = { ...complete };
  const out = applyListingDerived(row);
  assert.equal(out.estimatedFee, 6);
  assert.equal(out.grossProfit, 69);
  assert.equal(out.grossProfitRate, 0.69);
  assert.equal(out.profitPrice, 40);
  assert.equal(out.profitRate, 0.4);
});

test("applyListingDerived 缺因子时三列均为 null（不造 0）", () => {
  const out = applyListingDerived({ price: 100, purchaseCost: 20 });
  assert.equal(out.estimatedFee, null);
  assert.equal(out.grossProfit, null);
  assert.equal(out.grossProfitRate, null);
});

test("listings 毛利三列已登记，毛利率为比率列不参与求和", () => {
  const keys = visibleColumns("listings", ["estimatedFee", "grossProfit", "grossProfitRate"]).map(c => c.key);
  for (const key of ["estimatedFee", "grossProfit", "grossProfitRate"]) assert.ok(keys.includes(key), `缺少列 ${key}`);
  const summable = summableColumnKeys(columns.listings);
  assert.ok(summable.includes("estimatedFee"));
  assert.ok(summable.includes("grossProfit"));
  assert.equal(summable.includes("grossProfitRate"), false);
});
