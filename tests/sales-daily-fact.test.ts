import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesDailyFacts, SALES_DAILY_FACT_BASIS } from "../src/lib/amazon-sync/sales-daily-fact";

const line = (o: Partial<Parameters<typeof buildSalesDailyFacts>[0][number]>) => ({
  amazonOrderId: "A1", sellerSku: "SKU1", asin: "B000000001", businessDate: "2026-11-18",
  currency: "USD", quantity: 2, amount: "20.00", isRefund: false, ...o,
});

test("按 (sku, asin, date, currency) 聚合，distinct 订单数，金额保真", () => {
  const rows = buildSalesDailyFacts([
    line({ amazonOrderId: "A1", quantity: 2, amount: "20.00" }),
    line({ amazonOrderId: "A1", quantity: 1, amount: "10.00" }), // 同订单第二个 item → 订单数仍 1
    line({ amazonOrderId: "A2", quantity: 3, amount: "30.00" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderCount, 2, "distinct 订单数，不是 3 个 item");
  assert.equal(rows[0].unitsOrdered, "6");
  assert.equal(rows[0].grossSales, "60");
  assert.equal(rows[0].lineCount, 3);
});

test("退款行冲减数量/金额，不新增订单数", () => {
  const rows = buildSalesDailyFacts([
    line({ amazonOrderId: "A1", quantity: 5, amount: "50" }),
    line({ amazonOrderId: "A1", quantity: 2, amount: "-20", isRefund: true }),
  ]);
  assert.equal(rows[0].orderCount, 1);
  assert.equal(rows[0].unitsOrdered, "5");
  assert.equal(rows[0].refundUnits, "2");
  assert.equal(rows[0].refundAmount, "20");
  assert.equal(rows[0].netUnits, "3");
  assert.equal(rows[0].netSales, "30");
});

test("分币种不混算", () => {
  const rows = buildSalesDailyFacts([
    line({ currency: "USD", amount: "10" }),
    line({ currency: "EUR", amount: "10" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].currency, "EUR");
  assert.equal(rows[1].currency, "USD");
});

test("缺值不补零：数量为 null 时 units 为 null", () => {
  const rows = buildSalesDailyFacts([
    line({ quantity: null, amount: "10" }),
    line({ amazonOrderId: "A2", quantity: 2, amount: "20" }),
  ]);
  assert.equal(rows[0].unitsOrdered, null, "任一分量缺失 → 整列 null，不补零");
  assert.equal(rows[0].grossSales, "30", "金额分量仍聚合");
});

test("无币种的行不纳入（不臆造币种）；非法日期拒绝", () => {
  const rows = buildSalesDailyFacts([line({ currency: null })]);
  assert.equal(rows.length, 0);
  assert.throws(() => buildSalesDailyFacts([line({ businessDate: "bad" })]), /YYYY-MM-DD/);
});

test("basis 说明含 distinct 订单与分币种口径", () => {
  assert.match(SALES_DAILY_FACT_BASIS, /distinct amazonOrderId/);
  assert.match(SALES_DAILY_FACT_BASIS, /不跨币种相加/);
});
