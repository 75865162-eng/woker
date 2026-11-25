/**
 * WIMOOR 库存落地页 → 亚马逊真实库存适配层契约测试。
 * 验证：字段映射正确、不造数（缺值留 null）、不臆造（分量缺失合计为 null）、站点原样透传。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mapAmazonInventoryToFbaRow,
  mapAmazonInventoryRows,
  AMAZON_INVENTORY_PAGE_BASIS,
  type AmazonInventoryRow,
} from "../src/lib/wimoor-migration/amazon-inventory-adapter";

const full: AmazonInventoryRow = {
  id: "inv-1",
  sellerSku: "04-KZ5M-31CG",
  asin: "B0C69B1SYP",
  fnSku: "X003U2DHXN",
  marketplaceId: "A1AM78C64UM0Y8",
  condition: "NewItem",
  fulfillableQuantity: 12,
  inboundWorkingQuantity: 3,
  inboundShippedQuantity: 2,
  inboundReceivingQuantity: 1,
  reservedQuantity: 4,
  unfulfillableQuantity: 1,
  researchingQuantity: 0,
  capturedAt: "2026-11-25T08:29:38.155Z",
};

test("真实库存行映射：SKU/ASIN/站点/数量逐字段对应，合计为分量之和", () => {
  const r = mapAmazonInventoryToFbaRow(full);
  assert.equal(r.id, "inv-1");
  assert.equal(r.source, "amazon_inventory_snapshot");
  assert.equal(r.sku, "04-KZ5M-31CG");
  assert.equal(r.asin, "B0C69B1SYP");
  assert.equal(r.warehouse, "A1AM78C64UM0Y8");
  assert.equal(r.afnFulfillableQuantity, 12);
  assert.equal(r.afnReservedQuantity, 4);
  assert.equal(r.afnInboundWorkingQuantity, 3);
  // 12+3+2+1+4+1+0 = 23
  assert.equal(r.afnWarehouseQuantity, 23);
});

test("不造数：无真实来源的 WIMOOR 列留 null（前端显示—）", () => {
  const r = mapAmazonInventoryToFbaRow(full);
  assert.equal(r.stockingCycle, null);
  assert.equal(r.minCycle, null);
  assert.equal(r.firstLegCharges, null);
});

test("不臆造：数量分量缺失时为 null，合计也为 null（不补零）", () => {
  const r = mapAmazonInventoryToFbaRow({
    sellerSku: "SKU-2", marketplaceId: "ATVPDKIKX0DER",
    fulfillableQuantity: 5, reservedQuantity: null,
  });
  assert.equal(r.afnFulfillableQuantity, 5);
  assert.equal(r.afnReservedQuantity, null);
  assert.equal(r.afnWarehouseQuantity, null, "任一分量缺失则合计 null，不臆造 0");
});

test("站点原样透传，不跨站点相加", () => {
  const rows = mapAmazonInventoryRows([
    { ...full, id: "a", marketplaceId: "A1AM78C64UM0Y8" },
    { ...full, id: "b", marketplaceId: "A2EUQ1WTGCTBG2" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].warehouse, "A1AM78C64UM0Y8");
  assert.equal(rows[1].warehouse, "A2EUQ1WTGCTBG2");
});

test("缺 id 时以索引生成稳定行键，保持表格可渲染", () => {
  const r = mapAmazonInventoryToFbaRow({ sellerSku: "X" }, 7);
  assert.equal(r.id, "amazon-inv-7");
});

test("口径说明显式声明不造数原则", () => {
  assert.match(AMAZON_INVENTORY_PAGE_BASIS, /已发布库存快照/);
  assert.match(AMAZON_INVENTORY_PAGE_BASIS, /不.*伪造|不以 0/);
});
