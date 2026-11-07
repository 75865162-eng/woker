import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GET as orders } from "@/app/api/sellfox/orders/route";
import { GET as shipments } from "@/app/api/sellfox/shipments/route";
import { GET as restock } from "@/app/api/sellfox/restock/route";
import { createLocalSession } from "@/lib/auth/session";
import { readSellfoxRestock } from "@/lib/sellfox/restock-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

const scope = { organizationId: "org-a", workspaceId: "workspace-a" };
const capturedAt = new Date("2026-11-06T00:00:00.000Z");

test("order, shipment and restock routes return replica rows, pagination and facets", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  let inventoryQuantity: number | null = 0;
  let shipmentCollected = true;
  const orderLine = {
    id: "order-line", shopExternalId: "shop-a", orderId: "111-1", sellerOrderId: null, asin: "B000", msku: "MSKU", sku: "SKU", orderStatus: "Shipped",
    purchaseDate: "2026-11-01", purchaseDateRaw: "2026-11-01 08:00:00", payAt: null, refundAt: null, currency: "USD", orderTotal: 19.99, qty: 2, refundQty: null,
    itemAmount: 19.99, revenue: 5, promo: null, shipServiceLevel: "Standard", fulfillmentChannel: "AFN", SellfoxStore: { name: "店铺", marketplace: "US", externalId: "shop-a" },
  };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop-a", name: "店铺" }], findFirst: async () => null },
    sellfoxSyncRun: { findFirst: async () => ({ id: "run", status: "failed", error: null, summary: { progress: { orders: { "shop-b": { error: "赛狐接口调用失败（HTTP 403 / 40021，访问的接口暂无权限）。" } }, fba_shipments: { "shop-b": { error: "货件响应缺少商品行 items。" } } } } }) },
    sellfoxOrderSnapshot: {
      count: async ({ where }: { where: { orderStatus?: string } }) => where.orderStatus === "Canceled" ? 0 : 1,
      findMany: async ({ where, select }: { where?: { orderStatus?: string }; select?: unknown }) => select ? [{ orderStatus: "Shipped" }] : where?.orderStatus === "Canceled" ? [] : [orderLine],
      aggregate: async () => ({ _sum: { qty: 2 }, _count: { qty: 1 } }),
    },
    sellfoxFbaShipmentSnapshot: { findMany: async () => [{
      id: "ship-line", storeId: "store", shopExternalId: "shop-a", shipmentId: "FBA-1", shipmentName: "十一月货件", status: "SHIPPED", lineKey: "1", asin: "B000", msku: "MSKU", sku: "SKU",
      declaredQty: 10, shippedQty: 10, receivedQty: 4, sourceCreatedAt: "2026-11-01 01:00:00", shippedAt: null, fulfillmentCenterId: "ABE1", latestCapturedAt: capturedAt,
      SellfoxStore: { name: "店铺", marketplace: "US", SellfoxSnapshotHead: [{ capturedAt }] },
    }] },
    sellfoxSalesDailySnapshot: { findMany: async () => [{ storeId: "store", msku: "MSKU", asin: "B000", reportDate: "2026-11-01", quantity: 2 }] },
    sellfoxSnapshotHead: { findMany: async ({ where }: { where: { resource: string; storeId: { in: string[] }; SellfoxStore: typeof scope } }) => {
      assert.equal(where.resource, "fba_shipments");
      assert.deepEqual(where.storeId.in, ["store"]);
      assert.deepEqual(where.SellfoxStore, scope);
      return shipmentCollected ? [{ storeId: "store" }] : [];
    } },
    $queryRaw: async (sql: { text: string }) => sql.text.includes("sellfox_listing_current")
      ? [{ id: "listing", storeId: "store", asin: "B000", msku: "MSKU", sku: "SKU", parentAsin: null, title: "标题", mainImage: "https://example.test/a.jpg", fulfillable: 10, reservedQty: 1, unsellable: 0, warehousing: 0, fulfillment: "AFN", shopExternalId: "shop-a", name: "店铺", marketplace: "US" }]
      : sql.text.includes("SellfoxFbaInventorySnapshot") ? [{ storeId: "store", msku: "MSKU", reportDate: "2026-11-01", quantity: inventoryQuantity }]
      : [{ storeId: "store", msku: "MSKU", asin: "B000", status: "SHIPPED", declaredQty: 4, receivedQty: 0 }],
  } as unknown as PrismaClient;
  async function request(path: string, params = "") {
    const session = await createLocalSession({ id: "actor", ...scope, organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    return new Request(`http://localhost${path}?${params}`, { headers: { "x-workspace-id": scope.workspaceId, cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
  }
  try {
    assert.equal((await orders(new Request("http://localhost/api/sellfox/orders"))).status, 401);
    const orderResponse = await orders(await request("/api/sellfox/orders", "page=1&pageSize=20&searchType=order&search=111-1"));
    const orderBody = await orderResponse.json();
    assert.equal(orderResponse.status, 200, JSON.stringify(orderBody));
    assert.ok(orderBody.pagination, JSON.stringify(orderBody));
    assert.equal(orderBody.pagination.total, 1);
    assert.equal(orderBody.pagination.pageSize, 20);
    assert.deepEqual(orderBody.facets.productTags, []);
    assert.equal(orderBody.rows[0].orderId, "111-1");
    assert.equal(orderBody.rows[0].status, "Shipped");
    assert.equal(orderBody.rows[0].asin, "B000");
    assert.equal(orderBody.rows[0].qty, 2);
    assert.equal(orderBody.totals[0].qty, 2);
    assert.match(orderBody.failures[0].error, /暂无权限/);
    const filtered = await (await orders(await request("/api/sellfox/orders", "orderStatus=Canceled"))).json();
    assert.equal(filtered.pagination.total, 0);
    assert.deepEqual(filtered.rows, []);

    const shipmentBody = await (await shipments(await request("/api/sellfox/shipments", "status=SHIPPED&shopIds=shop-a"))).json();
    assert.equal(shipmentBody.rows.length, 1);
    assert.equal(shipmentBody.rows[0].shipmentId, "FBA-1");
    assert.equal(shipmentBody.rows[0].name, "十一月货件");
    assert.equal(shipmentBody.rows[0].declared, 10);
    assert.equal(shipmentBody.pagination.total, 1);
    assert.ok(Array.isArray(shipmentBody.facets.statuses));
    assert.match(shipmentBody.failures[0].error, /商品行/);

    const restockResponse = await restock(await request("/api/sellfox/restock", "dimension=asin&page=1&pageSize=20"));
    const restockBody = await restockResponse.json();
    assert.equal(restockResponse.status, 200, JSON.stringify(restockBody));
    assert.equal(restockBody.pagination.page, 1);
    assert.equal(restockBody.rows[0].asin, "B000");
    assert.equal(restockBody.rows[0].msku, "MSKU");
    assert.equal(restockBody.rows[0].fulfillable, 10);
    assert.equal(restockBody.rows[0].inTransit, 4);
    assert.ok("suggest" in restockBody.rows[0]);
    assert.deepEqual(restockBody.facets.salespersons, []);
    assert.equal(restockBody.formula.prepDays, 30);
    assert.equal(restockBody.formula.safetyDays, 7);

    const query = sellfoxBrowseQuery(new URL("http://localhost?dimension=msku"));
    const stockout = await readSellfoxRestock(query, scope, ["store"], "2026-11-06");
    assert.equal(stockout.rows[0].daily, null);
    assert.equal(stockout.rows[0].suggest, null);
    inventoryQuantity = 5;
    const stocked = await readSellfoxRestock(query, scope, ["store"], "2026-11-06");
    assert.equal(stocked.rows[0].daily, 2);
    assert.equal(stocked.rows[0].suggest, 60);
    inventoryQuantity = null;
    const unknownStock = await readSellfoxRestock(query, scope, ["store"], "2026-11-06");
    assert.equal(unknownStock.rows[0].daily, 2);
    shipmentCollected = false;
    const uncollected = await readSellfoxRestock(query, scope, ["store"], "2026-11-06");
    assert.equal(uncollected.rows[0].inTransit, null);
    assert.equal(uncollected.rows[0].suggest, null);
  } finally {
    globals.prisma = previous;
    if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = env.DATABASE_URL;
    if (env.AUTH_DRIVER === undefined) delete process.env.AUTH_DRIVER; else process.env.AUTH_DRIVER = env.AUTH_DRIVER;
  }
});
