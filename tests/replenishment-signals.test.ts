import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplenishmentSignals, buildReplenishmentSummary,
  type SkuInventoryInput,
} from "../src/lib/amazon-sync/replenishment-signals";

const inv = (over: Partial<SkuInventoryInput> = {}): SkuInventoryInput => ({
  marketplaceId: "ATVPDKIKX0DER", sellerSku: "SKU-1", asin: "B0TEST",
  fulfillable: 100, inbound: 50, reserved: 5, ...over,
});
const sale = (units30: number | null, units90: number | null, daysWithSales30: number) => ({ units30, units90, daysWithSales30 });
const map = (k: string, v: ReturnType<typeof sale>) => new Map([[k, v]]);
const K = "ATVPDKIKX0DER\u0000SKU-1";

test("补货信号：覆盖周数按可售/日均销量计算", () => {
  // 可售 100，近30天 70 件 / 7 天有数据 => 日均 10 => daysOfCover=10 => weeks=1.428571
  const rows = buildReplenishmentSignals([inv()], map(K, sale(70, 200, 7)));
  assert.equal(rows[0].dailyDemand30, "10");
  assert.equal(rows[0].daysOfCover, "10");
  assert.equal(rows[0].weeksOfCover, "1.428571");
  assert.equal(rows[0].signal, "NORMAL");
});

test("补货信号：日均缺失或为 0 时覆盖周数为 null，不补零", () => {
  const noSales = buildReplenishmentSignals([inv()], map(K, sale(null, null, 0)));
  assert.equal(noSales[0].daysOfCover, null);
  assert.equal(noSales[0].weeksOfCover, null);
  const zeroDays = buildReplenishmentSignals([inv()], map(K, sale(0, 0, 0)));
  assert.equal(zeroDays[0].daysOfCover, null);
});

test("补货信号：STOCKOUT_RISK / SLOW_MOVING / NO_SALE_90D 分类", () => {
  const stockout = buildReplenishmentSignals([inv({ fulfillable: 0, inbound: 0 })], map(K, sale(70, 200, 7)));
  assert.equal(stockout[0].signal, "STOCKOUT_RISK");
  const slow = buildReplenishmentSignals([inv({ fulfillable: 10 })], map(K, sale(0, 100, 0)));
  assert.equal(slow[0].signal, "SLOW_MOVING");
  const noSale = buildReplenishmentSignals([inv({ fulfillable: 10 })], map(K, sale(null, 0, 0)));
  assert.equal(noSale[0].signal, "NO_SALE_90D");
});

test("补货信号：汇总按信号计数", () => {
  const rows = buildReplenishmentSignals([
    inv({ sellerSku: "A", fulfillable: 0, inbound: 0 }),
    inv({ sellerSku: "B", fulfillable: 10 }),
    inv({ sellerSku: "C" }),
  ], new Map());
  const s = buildReplenishmentSummary(rows);
  assert.equal(s.skuCount, 3);
  assert.equal(s.stockoutRisk, 1);
});
