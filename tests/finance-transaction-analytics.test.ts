import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeeTypeRows, buildFinanceMonthRows, FINANCE_ANALYTICS_BASIS,
  type FinanceLineInput,
} from "../src/lib/amazon-sync/finance-transaction-analytics";

const line = (t: string, c: string, amount: string, postedAt: string, classification = "NON_ORDER"): FinanceLineInput => ({
  transactionType: t, currency: c, amount, postedAt, classification,
});

test("费用透视：按 transactionType × currency 汇总笔数与金额，负数扣费保原符号", () => {
  const rows = buildFeeTypeRows([
    line("ServiceFee", "USD", "-10", "2026-11-01T00:00:00Z"),
    line("ServiceFee", "USD", "-5.5", "2026-11-02T00:00:00Z"),
    line("ServiceFee", "EUR", "-3", "2026-11-02T00:00:00Z"),
    line("FBAInventoryReimbursement", "USD", "8", "2026-11-03T00:00:00Z"),
  ]);
  assert.equal(rows.length, 3);
  const usd = rows.find(r => r.transactionType === "ServiceFee" && r.currency === "USD")!;
  assert.equal(usd.count, 2);
  assert.equal(usd.amount, "-15.5");
  const eur = rows.find(r => r.currency === "EUR")!;
  assert.equal(eur.amount, "-3");
});

test("费用透视：空类型/空币种行被跳过，不生成空键", () => {
  const rows = buildFeeTypeRows([
    line("", "USD", "-1", "2026-11-01T00:00:00Z"),
    line("ServiceFee", "", "-1", "2026-11-01T00:00:00Z"),
  ]);
  assert.equal(rows.length, 0);
});

test("月度经营：按 UTC 年月 × 币种分列收入/非订单费用/净额", () => {
  const rows = buildFinanceMonthRows([
    line("Order", "USD", "100", "2026-11-03T00:00:00Z", "ORDER_RELATED"),
    line("Order", "USD", "50", "2026-11-18T00:00:00Z", "ORDER_RELATED"),
    line("ServiceFee", "USD", "-10", "2026-11-05T00:00:00Z", "NON_ORDER"),
    line("ServiceFee", "EUR", "-4", "2026-11-06T00:00:00Z", "NON_ORDER"),
    line("Order", "USD", "20", "2026-10-30T00:00:00Z", "ORDER_RELATED"),
  ]);
  assert.equal(rows.length, 3);
  const nov = rows.find(r => r.month === "2026-11" && r.currency === "USD")!;
  assert.equal(nov.orderCount, 2);
  assert.equal(nov.orderAmount, "150");
  assert.equal(nov.nonOrderCount, 1);
  assert.equal(nov.nonOrderAmount, "-10");
  assert.equal(nov.netAmount, "140");
  const novEur = rows.find(r => r.month === "2026-11" && r.currency === "EUR")!;
  assert.equal(novEur.orderCount, 0);
  assert.equal(novEur.nonOrderAmount, "-4");
});

test("月度经营：非法时间戳跳过，金额缺失按 0 计但不生成空组", () => {
  const rows = buildFinanceMonthRows([
    line("Order", "USD", "5", "not-a-date", "ORDER_RELATED"),
    line("Order", "", "5", "2026-11-01T00:00:00Z", "ORDER_RELATED"),
  ]);
  assert.equal(rows.length, 0);
});

test("口径声明：不折算、仅 ATTRIBUTED、隔离行不计入", () => {
  assert.match(FINANCE_ANALYTICS_BASIS, /原币不折算/);
  assert.match(FINANCE_ANALYTICS_BASIS, /ATTRIBUTED/);
  assert.match(FINANCE_ANALYTICS_BASIS, /隔离/);
  assert.match(FINANCE_ANALYTICS_BASIS, /不接赛狐/);
});
