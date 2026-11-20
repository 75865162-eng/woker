import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildInventoryOverview,
  buildSellerAsins,
  SALES_BASIS,
  type OverviewSourceRow,
  type OverviewInventoryRow,
  type AsinInventoryRow,
  type AsinTitleRow,
  type AsinImageRow,
  type AsinOrderRow,
} from "@/lib/amazon/inventory-workbench";

const root = process.cwd();

const sources: OverviewSourceRow[] = [
  { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", sellerName: "Coco店-US", capturedAt: new Date("2026-11-20T10:00:00Z"), freshnessMinutes: 360 },
  { sellerAccountId: "s2", marketplaceId: "ATVPDKIKX0DER", sellerName: "Coco店", capturedAt: new Date("2026-11-20T10:00:00Z"), freshnessMinutes: 360 },
  { sellerAccountId: "s3", marketplaceId: "A1PA6795UKMFR9", sellerName: "德国小店", capturedAt: null, freshnessMinutes: 360 },
];

test("buildInventoryOverview derives site/seller groups from published inventory rows", () => {
  const rows: OverviewInventoryRow[] = [
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B01", sellerSku: "SKU-1", fulfillableQuantity: 5, inboundWorkingQuantity: 1, inboundShippedQuantity: 2, inboundReceivingQuantity: 0, reservedQuantity: 1, unfulfillableQuantity: 0 },
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B01", sellerSku: "SKU-1B", fulfillableQuantity: 3, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 1 },
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B02", sellerSku: "SKU-2", fulfillableQuantity: 2, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
    { sellerAccountId: "s3", marketplaceId: "A1PA6795UKMFR9", asin: "B09", sellerSku: "SKU-DE", fulfillableQuantity: 4, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
    { sellerAccountId: "ghost", marketplaceId: "ATVPDKIKX0DER", asin: "BX", sellerSku: "SKU-X", fulfillableQuantity: 99, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
  ];
  const result = buildInventoryOverview(sources, rows);
  assert.equal(result.sellers.length, 3); // 只列已发布数据源骨架，幽灵店铺不入名单
  const s1 = result.sellers.find((s) => s.sellerAccountId === "s1")!;
  assert.equal(s1.asinCount, 2); // B01/B02 去重
  assert.equal(s1.skuCount, 3); // SKU-1 / SKU-1B / SKU-2 三个不同 SKU
  assert.equal(s1.available, 10); // 5+3+2
  assert.equal(s1.inbound, 3); // 1+2
  assert.equal(s1.reserved, 1);
  assert.equal(s1.unfulfillable, 1);
  assert.equal(s1.code, "US");
  assert.equal(s1.label, "美国站");
  const s2 = result.sellers.find((s) => s.sellerAccountId === "s2")!;
  assert.equal(s2.asinCount, 0); // 无库存行，不补 0 商品，但名单保留
  const s3 = result.sellers.find((s) => s.sellerAccountId === "s3")!;
  assert.equal(s3.freshness, "NOT_SYNCED"); // capturedAt 为空
  assert.equal(result.sites.length, 2);
  const us = result.sites.find((s) => s.marketplaceId === "ATVPDKIKX0DER")!;
  assert.equal(us.sellerCount, 2);
  assert.equal(us.asinCount, 2);
  assert.deepEqual(result.coverage, { sites: 2, sellers: 3, asins: 3, inventoryRows: 5, truncated: false });
});

test("buildInventoryOverview keeps unknown marketplace ID as-is and honors truncated flag", () => {
  const odd: OverviewSourceRow[] = [{ sellerAccountId: "x", marketplaceId: "UNKNOWN", sellerName: "未知站", capturedAt: null, freshnessMinutes: 360 }];
  const result = buildInventoryOverview(odd, [], true);
  assert.equal(result.sites[0].code, "UNKNOWN");
  assert.equal(result.sites[0].label, "UNKNOWN");
  assert.equal(result.coverage.truncated, true);
});

test("buildSellerAsins collapses inventory by ASIN and merges title/image/order-basis sales", () => {
  const inv: AsinInventoryRow[] = [
    { asin: "B01", sellerSku: "SKU-1", fulfillableQuantity: 5, inboundWorkingQuantity: 1, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 1, unfulfillableQuantity: 0 },
    { asin: "B01", sellerSku: "SKU-1B", fulfillableQuantity: 2, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 1 },
    { asin: "B02", sellerSku: "SKU-2", fulfillableQuantity: 1, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
    { asin: "", sellerSku: "NO-ASIN", fulfillableQuantity: 99, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 0 },
  ];
  const titles: AsinTitleRow[] = [
    { asin: "B01", title: "   ", preferred: false },
    { asin: "B01", title: "标题A", preferred: false },
    { asin: "B01", title: "catalog 标题", preferred: true },
  ];
  const images: AsinImageRow[] = [{ asin: "B01", fileId: "file-1" }];
  const orders: AsinOrderRow[] = [
    { asin: "B01", orderCount: 4, saleQuantity: 9 },
    { asin: "B02", orderCount: 1, saleQuantity: 1 },
  ];
  const rows = buildSellerAsins(inv, titles, images, orders);
  assert.equal(rows.length, 2); // 空 ASIN 不入；B01 收敛为一行
  const a = rows.find((r) => r.asin === "B01")!;
  assert.equal(a.available, 7);
  assert.equal(a.inbound, 1);
  assert.equal(a.reserved, 1);
  assert.equal(a.unfulfillable, 1);
  assert.equal(a.title, "catalog 标题"); // preferred source 覆盖，空标题被忽略
  assert.equal(a.imageFileId, "file-1");
  assert.equal(a.saleQuantity, 9);
  assert.equal(a.orderCount, 4);
  const b = rows.find((r) => r.asin === "B02")!;
  assert.equal(b.title, ""); // 无标题不臆造
  assert.equal(b.imageFileId, null);
  // 无库存、仅有订单的 ASIN 不补进来（本页是库存工作台）
  assert.ok(!rows.some((r) => r.asin === "B99"));
});

test("sales basis text states order-basis, not daily snapshot", () => {
  assert.match(SALES_BASIS, /订单商品表/);
  assert.match(SALES_BASIS, /不是按日销量快照/);
});

test("API routes keep response body as plain object and never spread a Response", () => {
  for (const rel of [
    "src/app/api/amazon/inventory-workbench/route.ts",
    "src/app/api/amazon/inventory-workbench/asins/route.ts",
  ]) {
    const source = readFileSync(path.join(root, rel), "utf8").replace(/\/\/.*$/gm, "");
    const m = source.match(/const body = await read[\s\S]*?;\s*return NextResponse\.json\(\{ \.\.\.body/);
    assert.ok(m, `${rel} 必须 await 数据层后用普通对象 body 展开进 NextResponse.json`);
    assert.ok(!/return NextResponse\.json\(\{\s*\.\.\.result\.body/.test(source));
  }
});
