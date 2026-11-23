import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTodayDashboard, shiftDay,
  type TodayOrderLine, type TodayInventory,
} from "../src/lib/amazon-sync/today-dashboard";

const TODAY = "2026-11-23";

function line(sku: string, day: string, qty: number, proceeds: string | null, currency: string | null, asin: string | null = "ASIN000001"): TodayOrderLine {
  return { sku, asin, businessDate: day, quantity: qty, proceeds, currency };
}

test("shiftDay: 跨月/跨年正确", () => {
  assert.equal(shiftDay("2026-11-23", -1), "2026-11-22");
  assert.equal(shiftDay("2026-11-23", -7), "2026-11-16");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});

test("三日并列：今日/昨日/上周同日各自聚合，销量求和", () => {
  const lines = [
    line("SKU-1", TODAY, 2, "20.00", "USD"),
    line("SKU-1", TODAY, 3, "30.00", "USD"),
    line("SKU-1", shiftDay(TODAY, -1), 5, "50.00", "USD"),
    line("SKU-1", shiftDay(TODAY, -7), 7, "70.00", "USD"),
  ];
  const rows = buildTodayDashboard(lines, [], TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].today.quantity, 5);
  assert.equal(rows[0].yesterday.quantity, 5);
  assert.equal(rows[0].lastWeekSameDay.quantity, 7);
  assert.equal(rows[0].today.sales[0].amount, "50");
});

test("缺日补 null（页面「—」），不补零", () => {
  const lines = [line("SKU-1", TODAY, 2, "20.00", "USD")];
  const rows = buildTodayDashboard(lines, [], TODAY);
  assert.equal(rows[0].today.quantity, 2);
  assert.equal(rows[0].yesterday.quantity, null);
  assert.equal(rows[0].lastWeekSameDay.quantity, null);
  assert.deepEqual(rows[0].yesterday.sales, []);
  assert.equal(rows[0].fulfillable, null);
});

test("销售额按币种分列，不跨币种相加", () => {
  const lines = [
    line("SKU-1", TODAY, 1, "10.00", "USD"),
    line("SKU-1", TODAY, 1, "9.00", "EUR"),
    line("SKU-1", TODAY, 1, "70.00", "CNY"),
  ];
  const rows = buildTodayDashboard(lines, [], TODAY);
  const sales = rows[0].today.sales;
  assert.equal(sales.length, 3);
  assert.deepEqual(sales, [
    { currency: "CNY", amount: "70" },
    { currency: "EUR", amount: "9" },
    { currency: "USD", amount: "10" },
  ]);
});

test("proceeds/currency 缺失时不计入销售额，但销量仍统计", () => {
  const lines = [
    line("SKU-1", TODAY, 3, null, null),
    line("SKU-1", TODAY, 2, "5.00", null),
  ];
  const rows = buildTodayDashboard(lines, [], TODAY);
  assert.equal(rows[0].today.quantity, 5);
  assert.deepEqual(rows[0].today.sales, []);
});

test("库存拼合：按 SKU 匹配，inbound 已是三段时间之和", () => {
  const lines = [line("SKU-1", TODAY, 1, "10.00", "USD")];
  const inv: TodayInventory[] = [
    { sku: "SKU-1", fulfillable: 100, reserved: 5, inbound: 20 },
    { sku: "SKU-2", fulfillable: 8, reserved: 0, inbound: null },
  ];
  const rows = buildTodayDashboard(lines, inv, TODAY);
  assert.equal(rows[0].fulfillable, 100);
  assert.equal(rows[0].reserved, 5);
  assert.equal(rows[0].inbound, 20);
});

test("库存仅拼合到有订单的 SKU，不单独产生行（看板聚焦今日订单）", () => {
  const rows = buildTodayDashboard(
    [line("SKU-1", TODAY, 1, "10.00", "USD")],
    [{ sku: "SKU-9", fulfillable: 3, reserved: 0, inbound: 0 }],
    TODAY,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "SKU-1");
  assert.equal(rows[0].fulfillable, null); // SKU-1 无库存快照 → null
});
