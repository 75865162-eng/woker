import assert from "node:assert/strict";
import test from "node:test";
import {
  metricsForWindow, buildProductPeriodRows, PRODUCT_PERIOD_WINDOWS,
  type ProductDayInput,
} from "../src/lib/amazon-sync/product-period-analytics";

// windowEnd = 2026-11-24；d7 = 11-18..11-24，d15 = 11-10..11-24，d30 = 10-26..11-24
const day = (date: string, units: number | null, sessions: number | null, identity = "ASIN1"): ProductDayInput => ({
  marketplaceId: "ATVPDKIKX0DER", identity, businessDate: date, units, sessions, pageViews: null,
});

test("商品多周期：窗口边界正确（d7 不含第 8 天）", () => {
  const lines = [
    day("2026-11-24", 10, 100),
    day("2026-11-18", 5, 50),
    day("2026-11-17", 99, 999), // 第 8 天，不在 d7
  ];
  const d7 = metricsForWindow(lines, "2026-11-24", 7);
  assert.equal(d7.units, 15);
  assert.equal(d7.sessions, 150);
  assert.equal(d7.cvr, "0.1");
  assert.equal(d7.daysWithData, 2);
  const d15 = metricsForWindow(lines, "2026-11-24", 15);
  assert.equal(d15.units, 114);
});

test("商品多周期：CVR 分母为 0 或缺失时为 null，不补零", () => {
  const zero = metricsForWindow([day("2026-11-24", 5, 0)], "2026-11-24", 7);
  assert.equal(zero.cvr, null);
  assert.equal(zero.units, 5);
  const missing = metricsForWindow([day("2026-11-24", 5, null)], "2026-11-24", 7);
  assert.equal(missing.cvr, null);
  assert.equal(missing.sessions, null);
});

test("商品多周期：窗口无数据行时指标为 null", () => {
  const empty = metricsForWindow([day("2026-01-01", 5, 50)], "2026-11-24", 7);
  assert.equal(empty.units, null);
  assert.equal(empty.sessions, null);
  assert.equal(empty.cvr, null);
  assert.equal(empty.daysWithData, 0);
});

test("商品多周期：按站点+identity 分列，产出 7/15/30/90 四窗口", () => {
  const rows = buildProductPeriodRows([
    day("2026-11-24", 4, 40, "ASIN1"),
    day("2026-11-24", 2, 20, "ASIN2"),
    { ...day("2026-11-24", 1, 10, "ASIN1"), marketplaceId: "A2PPCB" },
  ], "2026-11-24");
  assert.equal(rows.length, 3);
  assert.deepEqual(PRODUCT_PERIOD_WINDOWS, [7, 15, 30, 90]);
  const asin1 = rows.find(r => r.marketplaceId === "ATVPDKIKX0DER" && r.identity === "ASIN1")!;
  assert.equal(asin1.d7.units, 4);
  assert.equal(asin1.d90.cvr, "0.1");
});
