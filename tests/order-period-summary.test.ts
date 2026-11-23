import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateOrderPeriods, summarizeOrderPeriods,
  type OrderAggLine,
} from "../src/lib/amazon-sync/order-period-summary";
import { isoWeekOf, shiftDays } from "../src/lib/amazon-sync/sales-query";

function line(orderId: string, day: string, total: string | null, ccy: string | null, items: number, units: number): OrderAggLine {
  return { amazonOrderId: orderId, businessDate: day, grandTotalOriginal: total, currencyCode: ccy, itemCount: items, units };
}

const weekOf = (d: string) => { const w = isoWeekOf(d); return { key: `${w.year}-W${String(w.week).padStart(2, "0")}`, start: w.monday, end: shiftDays(w.monday, 6) }; };
const monthOf = (d: string) => { const key = d.slice(0, 7); const [y, m] = key.split("-").map(Number); return { key, start: d.slice(0, 8) + "01", end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; };

test("订单数 distinct：多订单项仍只算一单，订单项数与销量分列", () => {
  const lines = [
    line("ORD-1", "2026-11-23", "20.00", "USD", 3, 5),
    line("ORD-1", "2026-11-23", "20.00", "USD", 3, 5), // 同订单重复行（模拟item展开）不应重复计单
    line("ORD-2", "2026-11-23", "10.00", "USD", 1, 1),
  ];
  // 注意：查询层每订单头只产生一行；此处构造重复行验证 distinct 计数免疫
  const rows = aggregateOrderPeriods(lines, d => ({ key: d, start: d, end: d }));
  assert.equal(rows[0].orders, 2);          // distinct 订单数
  assert.equal(rows[0].orderItems, 7);      // 订单项行数（3+3+1）
  assert.equal(rows[0].units, "11");
});

test("销售额按币种分列，不跨币种相加", () => {
  const lines = [
    line("ORD-1", "2026-11-23", "10.00", "USD", 1, 1),
    line("ORD-2", "2026-11-23", "9.00", "EUR", 1, 1),
    line("ORD-3", "2026-11-23", "70.50", "CNY", 1, 1),
  ];
  const rows = aggregateOrderPeriods(lines, d => ({ key: d, start: d, end: d }));
  assert.deepEqual(rows[0].sales, [
    { currency: "CNY", amount: "70.50" },
    { currency: "EUR", amount: "9.00" },
    { currency: "USD", amount: "10.00" },
  ]);
});

test("金额缺失/非法不累计，但订单仍计数", () => {
  const lines = [
    line("ORD-1", "2026-11-23", null, null, 1, 1),
    line("ORD-2", "2026-11-23", "bad", "USD", 1, 1),
    line("ORD-3", "2026-11-23", "5.00", "USD", 1, 1),
  ];
  const rows = aggregateOrderPeriods(lines, d => ({ key: d, start: d, end: d }));
  assert.equal(rows[0].orders, 3);
  assert.deepEqual(rows[0].sales, [{ currency: "USD", amount: "5.00" }]);
});

test("按周分段：ISO 周 key 与起止日正确", () => {
  const lines = [
    line("ORD-1", "2026-11-22", "10.00", "USD", 1, 1), // 周日（ISO 属 W47）
    line("ORD-2", "2026-11-23", "10.00", "USD", 1, 1), // 周一（ISO 属 W48）
  ];
  const rows = aggregateOrderPeriods(lines, weekOf);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, "2026-W47");
  assert.equal(rows[1].period, "2026-W48");
});

test("按月分段：key/月初/月末正确", () => {
  const lines = [
    line("ORD-1", "2026-11-02", "10.00", "USD", 1, 1),
    line("ORD-2", "2026-11-30", "10.00", "USD", 1, 1),
    line("ORD-3", "2026-12-01", "10.00", "USD", 1, 1),
  ];
  const rows = aggregateOrderPeriods(lines, monthOf);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, "2026-11");
  assert.equal(rows[0].periodStart, "2026-11-01");
  assert.equal(rows[0].periodEnd, "2026-11-30");
  assert.equal(rows[1].period, "2026-12");
});

test("全期合计 distinct 订单 + 分币种", () => {
  const lines = [
    line("ORD-1", "2026-11-23", "10.00", "USD", 1, 1),
    line("ORD-1", "2026-11-24", "10.00", "USD", 1, 1), // 同ID跨日（异常但验证免疫）
    line("ORD-2", "2026-11-25", "20.00", "USD", 2, 3),
  ];
  const t = summarizeOrderPeriods(lines);
  assert.equal(t.orders, 2);
  assert.deepEqual(t.sales, [{ currency: "USD", amount: "40.00" }]);
});

test("空输入返回安全空合计", () => {
  const t = summarizeOrderPeriods([]);
  assert.equal(t.orders, 0);
  assert.equal(t.units, null);
  assert.deepEqual(t.sales, []);
});
