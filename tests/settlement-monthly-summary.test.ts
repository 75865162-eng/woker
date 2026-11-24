import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSettlementTypeRows, buildSettlementMonthRows, SETTLEMENT_MONTHLY_BASIS,
  type SettlementLineInput,
} from "../src/lib/amazon-sync/settlement-monthly-summary";

const line = (t: string, c: string, amount: string | null, date: string | null, orderId: string | null = null): SettlementLineInput => ({
  transactionType: t, currency: c, amount, businessDate: date, orderId,
});

test("交易类型透视：按 transactionType × currency 汇总笔数/金额/distinct 订单", () => {
  const rows = buildSettlementTypeRows([
    line("Order", "USD", "10", "2026-11-01", "O1"),
    line("Order", "USD", "20", "2026-11-02", "O1"), // 同订单，distinct 仍 1
    line("Order", "USD", "5", "2026-11-03", "O2"),
    line("Refund", "USD", "-3", "2026-11-03", "O1"),
    line("Order", "EUR", "8", "2026-11-01", "O3"),
  ]);
  assert.equal(rows.length, 3);
  const usdOrder = rows.find(r => r.transactionType === "Order" && r.currency === "USD")!;
  assert.equal(usdOrder.lineCount, 3);
  assert.equal(usdOrder.distinctOrders, 2);
  assert.equal(usdOrder.amount, "35");
  const refund = rows.find(r => r.transactionType === "Refund")!;
  assert.equal(refund.amount, "-3");
});

test("交易类型透视：空类型/空币种跳过", () => {
  const rows = buildSettlementTypeRows([line("", "USD", "1", "2026-11-01"), line("Order", "", "1", "2026-11-01")]);
  assert.equal(rows.length, 0);
});

test("月度趋势：按业务日年月 × 币种 × 类型，缺业务日跳过", () => {
  const rows = buildSettlementMonthRows([
    line("Order", "USD", "10", "2026-11-05"),
    line("Order", "USD", "20", "2026-11-18"),
    line("Refund", "USD", "-3", "2026-11-18"),
    line("Order", "USD", "7", "2026-10-30"),
    line("Order", "EUR", "8", "2026-11-01"),
    line("Order", "USD", "99", null), // 缺业务日跳过
    line("Order", "USD", "99", "not-a-date"),
  ]);
  const rowsNovUsdOrder = rows.find(r => r.month === "2026-11" && r.currency === "USD" && r.transactionType === "Order")!;
  assert.equal(rowsNovUsdOrder.lineCount, 2);
  assert.equal(rowsNovUsdOrder.amount, "30");
  const oct = rows.find(r => r.month === "2026-10")!;
  assert.equal(oct.amount, "7");
  // 无效日期未生成组
  assert.ok(!rows.some(r => r.amount === "99"));
});

test("金额缺失按 0 计（不补零估算），仍计笔数", () => {
  const rows = buildSettlementTypeRows([line("Order", "USD", null, "2026-11-01")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, "0");
  assert.equal(rows[0].lineCount, 1);
});

test("金额解析兼容逗号小数分隔符(BRL/欧洲)：'115,31'=115.31、'-17,61'=-17.61", () => {
  const rows = buildSettlementTypeRows([
    line("Order", "BRL", "115,31", "2026-11-01"),
    line("Refund", "BRL", "-17,61", "2026-11-01"),
    line("Order", "EUR", "1.234,56", "2026-11-01"), // 点千分位+逗号小数
  ]);
  const order = rows.find(r => r.transactionType === "Order" && r.currency === "BRL")!;
  assert.equal(order.amount, "115.31");
  const refund = rows.find(r => r.transactionType === "Refund")!;
  assert.equal(refund.amount, "-17.61");
  const eur = rows.find(r => r.currency === "EUR")!;
  assert.equal(eur.amount, "1234.56");
});

test("口径声明：仅 ATTRIBUTED、原币不折算、distinct 订单、不接赛狐", () => {
  assert.match(SETTLEMENT_MONTHLY_BASIS, /ATTRIBUTED/);
  assert.match(SETTLEMENT_MONTHLY_BASIS, /原币不折算/);
  assert.match(SETTLEMENT_MONTHLY_BASIS, /distinct orderId/);
  assert.match(SETTLEMENT_MONTHLY_BASIS, /不接赛狐/);
});
