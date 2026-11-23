import assert from "node:assert/strict";
import test from "node:test";
import { buildSettlementSkuPivot } from "../src/lib/amazon-sync/settlement-sku-pivot";
import { FEE_POOL_KEYS } from "../src/lib/amazon-sync/settlement-fee-classification";

test("透视：按 SKU+币种分组，8 类费用分列，本金与费用字符串保真", () => {
  const rows = buildSettlementSkuPivot([
    { sku: "SKU-1", currency: "USD", basisAmount: "100.000000", shareStorageFee: "2.5", shareAdvSpendFee: "1.5" },
    { sku: "SKU-1", currency: "USD", basisAmount: "50.000000", shareStorageFee: "1.5", shareCouponRedemptionFee: "1" },
  ]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.sku, "SKU-1");
  assert.equal(r.currency, "USD");
  assert.equal(r.lineCount, 2);
  assert.equal(r.basis, "150");
  assert.equal(r.fees.storageFee, "4");
  assert.equal(r.fees.advSpendFee, "1.5");
  assert.equal(r.fees.couponRedemptionFee, "1");
  assert.equal(r.fees.longStorageFee, "0");
  assert.equal(r.feeTotal, "6.5");
  assert.equal(r.settlementMargin, "143.5");
  assert.equal(r.marginRate, "0.956667");
  assert.equal(Object.keys(r.fees).length, FEE_POOL_KEYS.length);
});

test("透视：不同币种不合并，各自成行", () => {
  const rows = buildSettlementSkuPivot([
    { sku: "SKU-1", currency: "USD", basisAmount: "10" },
    { sku: "SKU-1", currency: "EUR", basisAmount: "10" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.currency), ["EUR", "USD"]);
});

test("透视：本金为 0 时毛利率为 null，不补零、不臆造", () => {
  const rows = buildSettlementSkuPivot([{ sku: "Z", currency: "USD", basisAmount: "0", shareStorageFee: "1" }]);
  assert.equal(rows[0].basis, "0");
  assert.equal(rows[0].settlementMargin, "-1");
  assert.equal(rows[0].marginRate, null);
});

test("透视：空 SKU / 空币种行被忽略；无效金额按 0", () => {
  const rows = buildSettlementSkuPivot([
    { sku: "", currency: "USD", basisAmount: "10" },
    { sku: "S", currency: "", basisAmount: "10" },
    { sku: "S2", currency: "USD", basisAmount: "not-a-number" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "S2");
  assert.equal(rows[0].basis, "0");
});

test("透视：排序稳定（先币种后 SKU）", () => {
  const rows = buildSettlementSkuPivot([
    { sku: "B", currency: "USD", basisAmount: "1" },
    { sku: "A", currency: "EUR", basisAmount: "1" },
    { sku: "A", currency: "USD", basisAmount: "1" },
  ]);
  assert.deepEqual(rows.map(r => `${r.currency}:${r.sku}`), ["EUR:A", "USD:A", "USD:B"]);
});
