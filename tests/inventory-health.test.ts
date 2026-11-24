import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInventoryHealthRows, buildInventoryHealthSummary, INVENTORY_HEALTH_BASIS,
  type InventoryLineInput,
} from "../src/lib/amazon-sync/inventory-health";

const line = (sku: string, f: number, r: number, i: number, u: number, res: number, site = "US"): InventoryLineInput => ({
  sellerSku: sku, asin: `${sku}-ASIN`, marketplaceId: site,
  fulfillable: f, reserved: r, inbound: i, unfulfillable: u, researching: res,
});

test("库存健康：状态分列 + 总量 + 在途占比", () => {
  const rows = buildInventoryHealthRows([line("SKU1", 10, 2, 8, 1, 0)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 21);
  assert.equal(rows[0].inbound, 8);
  assert.equal(rows[0].inboundRatio, "0.380952");
});

test("库存健康：缺货风险 = 可售0且在途0（即使有预留/不可用）", () => {
  const rows = buildInventoryHealthRows([line("SKU1", 0, 3, 0, 5, 0)]);
  assert.equal(rows[0].riskFlag, "OUT_OF_STOCK_RISK");
});

test("库存健康：滞销信号 = 可售>0且其余状态为0", () => {
  const rows = buildInventoryHealthRows([line("SKU1", 20, 0, 0, 0, 0)]);
  assert.equal(rows[0].riskFlag, "IDLE_SIGNAL");
});

test("库存健康：正常状态（有可售也有在途）", () => {
  const rows = buildInventoryHealthRows([line("SKU1", 20, 0, 5, 0, 0)]);
  assert.equal(rows[0].riskFlag, "NORMAL");
});

test("库存健康：全零 SKU 判为缺货风险，在途占比 null 不补零", () => {
  const rows = buildInventoryHealthRows([line("SKU1", 0, 0, 0, 0, 0)]);
  assert.equal(rows[0].total, 0);
  assert.equal(rows[0].inboundRatio, null);
  assert.equal(rows[0].riskFlag, "OUT_OF_STOCK_RISK");
});

test("库存健康汇总：分状态求和 + 风险/滞销计数", () => {
  const rows = buildInventoryHealthRows([
    line("SKU1", 10, 2, 8, 1, 0),
    line("SKU2", 0, 0, 0, 0, 0),
    line("SKU3", 20, 0, 0, 0, 0),
  ]);
  const s = buildInventoryHealthSummary(rows);
  assert.equal(s.skuCount, 3);
  assert.equal(s.fulfillable, 30);
  assert.equal(s.inbound, 8);
  assert.equal(s.outOfStockRiskCount, 1);
  assert.equal(s.idleSignalCount, 1);
});

test("口径声明：仅快照、按站点SKU去重、不接赛狐、不折算", () => {
  assert.match(INVENTORY_HEALTH_BASIS, /AmazonInventorySnapshot/);
  assert.match(INVENTORY_HEALTH_BASIS, /最近 capturedAt/);
  assert.match(INVENTORY_HEALTH_BASIS, /不接赛狐/);
  assert.match(INVENTORY_HEALTH_BASIS, /不补零/);
});
