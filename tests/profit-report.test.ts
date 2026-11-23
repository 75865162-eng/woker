import assert from "node:assert/strict";
import test from "node:test";
import { buildProfitSkuRows, buildProfitStoreRows, PROFIT_BASIS } from "../src/lib/amazon-sync/profit-report";
import type { SkuPivotRow } from "../src/lib/amazon-sync/settlement-sku-pivot";

const pivot = (sku: string, basis: string, feeTotal: string, margin: string): SkuPivotRow => ({
  sku, currency: "USD", lineCount: 1, basis,
  fees: { storageFee: "1", longStorageFee: "0", advSpendFee: "0", couponRedemptionFee: "0", reserveFee: "0", reimbursementFee: "0", disposalFee: "0", shopOtherFee: "0" },
  feeTotal, settlementMargin: margin, marginRate: "0.9",
});

test("利润表：成本/税费/本地费用列为 null 待接入，不臆造数字", () => {
  const rows = buildProfitSkuRows([pivot("SKU1", "100", "1", "99")], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost, null);
  assert.equal(rows[0].tax, null);
  assert.equal(rows[0].localExpense, null);
  assert.equal(rows[0].pendingSources.length, 3);
  assert.equal(rows[0].settlementMargin, "99");
});

test("利润表：广告花费按同币种 SKU=ASIN 匹配，仅参考不并入毛利", () => {
  const rows = buildProfitSkuRows([pivot("B0ABCDEF12", "100", "1", "99")], [{ asin: "b0abcdef12", currency: "USD", spend: "12.5" }]);
  assert.equal(rows[0].adSpend, "12.5");
  assert.match(rows[0].adSpendNote ?? "", /仅供参考/);
  assert.equal(rows[0].settlementMargin, "99"); // 广告未并入
});

test("利润表：广告币种不符不采用，adSpend 为 null", () => {
  const rows = buildProfitSkuRows([pivot("B0ABCDEF12", "100", "1", "99")], [{ asin: "B0ABCDEF12", currency: "EUR", spend: "12.5" }]);
  assert.equal(rows[0].adSpend, null);
});

test("利润表：非 ASIN 格式 SKU 不臆造广告匹配", () => {
  const rows = buildProfitSkuRows([pivot("MY-SKU", "100", "1", "99")], [{ asin: "B0ABCDEF12", currency: "USD", spend: "12.5" }]);
  assert.equal(rows[0].adSpend, null);
});

test("店铺汇总：按币种汇总本金/费用/毛利与 SKU 数", () => {
  const rows = buildProfitSkuRows([pivot("SKU1", "100", "10", "90"), pivot("SKU2", "50", "5", "45")], []);
  const stores = buildProfitStoreRows(rows, "SETTLE-001");
  assert.equal(stores.length, 1);
  assert.equal(stores[0].skuCount, 2);
  assert.equal(stores[0].principal, "150");
  assert.equal(stores[0].platformFeeTotal, "15");
  assert.equal(stores[0].settlementMargin, "135");
});

test("口径声明：明确标注不折算、不混算、待确认", () => {
  assert.match(PROFIT_BASIS, /原币不折算/);
  assert.match(PROFIT_BASIS, /分列不混算/);
  assert.match(PROFIT_BASIS, /待业务确认/);
});
