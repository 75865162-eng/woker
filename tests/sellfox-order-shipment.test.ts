import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { sellfoxOrderLines } from "@/lib/sellfox/order-contract";
import { sellfoxFbaShipmentHeader, sellfoxFbaShipmentLines, sellfoxFbaShipmentStatus } from "@/lib/sellfox/fba-shipment-contract";
import { syncSellfoxOrders } from "@/lib/sellfox/order-sync";
import { shipmentApiRows } from "@/lib/sellfox/shipments-read";

const order = {
  shopId: "shop-fixture",
  amazonOrderId: "111-0000000-0000000",
  sellerOrderId: "seller-1",
  orderStatus: "Shipped",
  purchaseDate: "2026-11-01 08:30:00",
  currency: "USD",
  orderTotal: "19.99",
  fulfillmentChannel: "AFN",
  shipServiceLevel: "Standard",
  address: { city: "Seattle" },
  orderItemVoList: [{ orderItemId: "line-1", asin: "B000", sellerSku: "MSKU", commoditySku: "SKU", quantityOrdered: "2", itemPrice: "19.99" }],
};

test("order OpenAPI rows map onto snapshot line fields and reject a foreign shop", () => {
  const [line] = sellfoxOrderLines(order, "shop-fixture");
  assert.equal(line.orderId, "111-0000000-0000000");
  assert.equal(line.lineKey, "line-1");
  assert.equal(line.asin, "B000");
  assert.equal(line.msku, "MSKU");
  assert.equal(line.sku, "SKU");
  assert.equal(line.orderStatus, "Shipped");
  assert.equal(line.purchaseDate, "2026-11-01");
  assert.equal(line.purchaseDateRaw, "2026-11-01 08:30:00");
  assert.equal(line.currency, "USD");
  assert.equal(line.orderTotal, 19.99);
  assert.equal(line.qty, 2);
  assert.equal(line.fulfillmentChannel, "AFN");
  assert.equal(line.shipServiceLevel, "Standard");
  assert.throws(() => sellfoxOrderLines(order, "other-shop"), /归属/);
  assert.throws(() => sellfoxOrderLines({ ...order, orderItemVoList: [{ ...order.orderItemVoList[0], orderItemId: "" }] }, "shop-fixture"), /身份/);
});

test("shipment lines keep Amazon inbound status and shipping-order codes", () => {
  assert.equal(sellfoxFbaShipmentStatus("3"), "SHIPPED");
  assert.equal(sellfoxFbaShipmentStatus(-1), "CANCELLED");
  assert.equal(sellfoxFbaShipmentStatus("in transit"), "IN_TRANSIT");
  // 实测契约：头行无 shopId/items，商品行走 itemsBatch（shopId 在商品行上校验）。
  const header = sellfoxFbaShipmentHeader({
    shipSn: "FBA-1", status: "1", createTime: "2026-11-01 01:00:00", itemTotalSize: "1", warehouseId: "155348",
  });
  assert.equal(header.shipmentId, "FBA-1");
  assert.equal(header.status, "WORKING");
  assert.equal(header.expectedLineCount, 1);
  const [line] = sellfoxFbaShipmentLines(header, {
    shipSn: "FBA-1",
    items: [{ shopId: "shop-fixture", asin: "B000", sellerSku: "MSKU", fnSku: "X000", quantity: "10", shipCount: "10", quantityReceived: "4", shipmentStatus: "SHIPPED" }],
  }, "shop-fixture");
  assert.equal(line.shipmentId, "FBA-1");
  assert.equal(line.status, "SHIPPED");
  assert.equal(line.declaredQty, 10);
  assert.equal(line.shippedQty, 10);
  assert.equal(line.receivedQty, 4);
  assert.equal(line.msku, "MSKU");
  assert.throws(() => sellfoxFbaShipmentHeader({ shipSn: "FBA-1", status: "mystery" }), /状态/);
  assert.throws(() => sellfoxFbaShipmentLines(header, { shipSn: "FBA-1", items: [] }, "shop-fixture"), /明细缺失/);
  assert.throws(() => sellfoxFbaShipmentLines(header, {
    shipSn: "FBA-1",
    items: [{ shopId: "other-shop", asin: "B000", sellerSku: "MSKU", quantity: "1" }],
  }, "shop-fixture"), /归属/);
  // 实测 FH11813300867：同一货件同一 SKU 分两行（20 件 + 10 件），合并为一行求和。
  const [merged] = sellfoxFbaShipmentLines({ ...header, expectedLineCount: 2 }, {
    shipSn: "FBA-1",
    items: [
      { shopId: "shop-fixture", asin: "B000", sellerSku: "MSKU", fnSku: "X000", quantity: "20", shipCount: "20", quantityReceived: "20" },
      { shopId: "shop-fixture", asin: "B000", sellerSku: "MSKU", fnSku: "X000", quantity: "10", shipCount: "10", quantityReceived: "0" },
    ],
  }, "shop-fixture");
  assert.equal(merged.declaredQty, 30);
  assert.equal(merged.shippedQty, 30);
  assert.equal(merged.receivedQty, 20);
});

test("shipment snapshot lines collapse to one API row with summed quantities", () => {
  const store = { name: "店铺", marketplace: "US" };
  const base = { organizationId: "org", workspaceId: "workspace", storeId: "store", shopExternalId: "shop-fixture", shipmentId: "FBA-1", shipmentName: "十一月货件", status: "SHIPPED", asin: "B000", sourceCreatedAt: "2026-11-01 01:00:00", sourceUpdatedAt: null, shippedAt: "2026-11-02 01:00:00", fulfillmentCenterId: "ABE1", latestCapturedAt: new Date(), payload: {}, syncedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), SellfoxStore: store };
  const rows = shipmentApiRows([
    { ...base, id: "a", lineKey: "1", msku: "MSKU-A", sku: "A", declaredQty: 10, shippedQty: 8, receivedQty: 3 },
    { ...base, id: "b", lineKey: "2", msku: "MSKU-B", sku: "B", declaredQty: 5, shippedQty: 5, receivedQty: 1 },
  ] as unknown as Parameters<typeof shipmentApiRows>[0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shipmentId, "FBA-1");
  assert.equal(rows[0].name, "十一月货件");
  assert.equal(rows[0].store, "店铺 / US");
  assert.equal(rows[0].mskuCount, 2);
  assert.equal(rows[0].declared, 15);
  assert.equal(rows[0].received, 4);
  assert.equal(rows[0].status, "SHIPPED");
});

test("order sync writes one snapshot upsert per item and records a failed shop", async () => {
  const writes: Prisma.SellfoxOrderSnapshotCreateInput[] = [];
  let checkpoint: Record<string, { error?: string; done?: boolean }> = {};
  const page = { pageNo: 1, pageSize: 100, totalPage: 1, totalSize: 1, rows: [order] };
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop-fixture" }, { id: "store-b", externalId: "shop-b" }] },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
      sellfoxOrderSnapshot: { upsert: async ({ create }: { create: Prisma.SellfoxOrderSnapshotCreateInput }) => { writes.push(create); } },
      sellfoxSnapshotHead: { upsert: async () => undefined },
    }),
  };
  const post = async (_path: string, body: { shopIdList: string[] }) => {
    if (body.shopIdList[0] === "shop-b") throw new Error("private transport");
    return page;
  };
  await assert.rejects(() => syncSellfoxOrders({
    organizationId: "org", workspaceId: "workspace", shopExternalIds: ["shop-fixture", "shop-b"], startDate: "2026-11-01", endDate: "2026-11-06", capturedAt: "2026-11-06T00:00:00.000Z",
    onProgress: async (next) => { checkpoint = next; },
  }, { db: db as never, post: post as never }), /1 个店铺订单采集失败/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].orderId, "111-0000000-0000000");
  assert.equal(writes[0].lineKey, "line-1");
  assert.equal(writes[0].qty, 2);
  assert.equal(writes[0].purchaseDate, "2026-11-01");
  assert.equal(checkpoint["shop-fixture"]?.done, true);
  assert.match(checkpoint["shop-b"]?.error ?? "", /同步处理异常/);
});
