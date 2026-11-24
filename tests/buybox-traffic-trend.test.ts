import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBuyBoxTrend, isoWeekOf, type BuyBoxDayInput,
} from "../src/lib/amazon-sync/buybox-traffic-trend";

const day = (asin: string, date: string, pct: number | null, sessions: number | null = 10, views: number | null = 20): BuyBoxDayInput => ({
  asin, businessDate: date, buyBoxPercentage: pct, sessions, pageViews: views,
});

test("BuyBox 趋势：ISO 周边界正确（周一为一周起点）", () => {
  const w = isoWeekOf("2026-11-24"); // 周二
  assert.equal(w.start, "2026-11-23");
  assert.equal(w.end, "2026-11-29");
});

test("BuyBox 趋势：按自然月上卷，占比取均值、流量求和、覆盖天数去重", () => {
  const rows = buildBuyBoxTrend([
    day("A", "2026-11-01", 80, 10, 20),
    day("A", "2026-11-02", 60, 5, 10),
    day("A", "2026-11-02", 55, 5, 10), // 同日重复版本，纯函数不全局去重（查询层已去重），这里仅验证上卷
    day("B", "2026-11-01", 100, 2, 3),
  ], "month");
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.asin === "A")!;
  assert.equal(a.periodKey, "2026-11");
  assert.equal(a.sessions, 20);
  assert.equal(a.pageViews, 40);
  assert.equal(a.avgBuyBoxPercentage, "65"); // (80+60+55)/3
});

test("BuyBox 趋势：缺失占比时不参与均值，不为 null 指标补零", () => {
  const rows = buildBuyBoxTrend([
    day("A", "2026-11-24", null, 5, null),
    day("A", "2026-11-25", 50, null, 30),
  ], "week");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].avgBuyBoxPercentage, "50");
  assert.equal(rows[0].sessions, 5);
  assert.equal(rows[0].pageViews, 30);
  assert.equal(rows[0].daysWithData, 2);
});

test("BuyBox 趋势：全缺失占比时均值为 null", () => {
  const rows = buildBuyBoxTrend([day("A", "2026-11-24", null, null, null)], "week");
  assert.equal(rows[0].avgBuyBoxPercentage, null);
  assert.equal(rows[0].sessions, null);
});
