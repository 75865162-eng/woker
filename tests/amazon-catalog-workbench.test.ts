import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCatalogOverview,
  buildSellerCatalogItems,
  SALES_BASIS,
  type OverviewSourceRow,
  type OverviewCatalogRow,
  type AsinCatalogRow,
  type AsinInventoryRow,
  type AsinTitleRow,
  type AsinImageRow,
  type SkuOrderRow,
} from "@/lib/amazon/catalog-workbench";

const root = process.cwd();

const sources: OverviewSourceRow[] = [
  { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", sellerName: "Coco店-US", capturedAt: new Date("2026-11-20T10:00:00Z"), freshnessMinutes: 2880 },
  { sellerAccountId: "s2", marketplaceId: "ATVPDKIKX0DER", sellerName: "Coco店", capturedAt: new Date("2026-11-20T10:00:00Z"), freshnessMinutes: 2880 },
  { sellerAccountId: "s3", marketplaceId: "A1PA6795UKMFR9", sellerName: "德国小店", capturedAt: null, freshnessMinutes: 2880 },
];

test("buildCatalogOverview derives site/seller groups from published catalog rows (SKU-level)", () => {
  const rows: OverviewCatalogRow[] = [
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B01", sellerSku: "SKU-1" },
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B01", sellerSku: "SKU-1B" },
    { sellerAccountId: "s1", marketplaceId: "ATVPDKIKX0DER", asin: "B02", sellerSku: "SKU-2" },
    { sellerAccountId: "s3", marketplaceId: "A1PA6795UKMFR9", asin: "", sellerSku: "SKU-DE" },
    { sellerAccountId: "ghost", marketplaceId: "ATVPDKIKX0DER", asin: "BX", sellerSku: "SKU-X" },
  ];
  const result = buildCatalogOverview(sources, rows);
  assert.equal(result.sellers.length, 3); // 只列已发布数据源骨架，幽灵店铺不入名单
  const s1 = result.sellers.find((s) => s.sellerAccountId === "s1")!;
  assert.equal(s1.skuCount, 3); // SKU-1 / SKU-1B / SKU-2
  assert.equal(s1.asinCount, 2); // B01/B02 去重
  assert.equal(s1.code, "US");
  assert.equal(s1.label, "美国站");
  const s2 = result.sellers.find((s) => s.sellerAccountId === "s2")!;
  assert.equal(s2.skuCount, 0); // 无目录行，名单保留但不补 0 商品
  const s3 = result.sellers.find((s) => s.sellerAccountId === "s3")!;
  assert.equal(s3.freshness, "NOT_SYNCED"); // capturedAt 为空
  assert.equal(s3.asinCount, 0); // 空 ASIN 不计数
  assert.equal(result.sites.length, 2);
  const us = result.sites.find((s) => s.marketplaceId === "ATVPDKIKX0DER")!;
  assert.equal(us.sellerCount, 2);
  assert.equal(us.skuCount, 3);
  assert.equal(us.asinCount, 2);
  assert.deepEqual(result.coverage, { sites: 2, sellers: 3, skus: 4, asins: 2, catalogRows: 5, truncated: false });
});

test("buildCatalogOverview keeps unknown marketplace ID as-is and honors truncated flag", () => {
  const odd: OverviewSourceRow[] = [{ sellerAccountId: "x", marketplaceId: "UNKNOWN", sellerName: "未知站", capturedAt: null, freshnessMinutes: 2880 }];
  const result = buildCatalogOverview(odd, [], true);
  assert.equal(result.sites[0].code, "UNKNOWN");
  assert.equal(result.sites[0].label, "UNKNOWN");
  assert.equal(result.coverage.truncated, true);
});

test("buildSellerCatalogItems merges title/image/inventory/order-basis sales by SKU", () => {
  const catalog: AsinCatalogRow[] = [
    { sellerSku: "SKU-1", asin: "B01", listingStatus: "ACTIVE", fulfillmentType: "FBA" },
    { sellerSku: "SKU-1B", asin: "B01", listingStatus: "INACTIVE", fulfillmentType: "FBA" },
    { sellerSku: "SKU-2", asin: "B02", listingStatus: "ACTIVE", fulfillmentType: "FBM" },
    { sellerSku: "NO-ASIN", asin: "", listingStatus: "ACTIVE", fulfillmentType: "FBA" },
    { sellerSku: "SKU-1", asin: "B01", listingStatus: "ACTIVE", fulfillmentType: "FBA" }, // 重复 SKU 去重
  ];
  const inv: AsinInventoryRow[] = [
    { sellerSku: "SKU-1", fulfillableQuantity: 5, inboundWorkingQuantity: 1, inboundShippedQuantity: 2, inboundReceivingQuantity: 0, reservedQuantity: 1, unfulfillableQuantity: 0 },
    { sellerSku: "SKU-2", fulfillableQuantity: 2, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 0, unfulfillableQuantity: 1 },
  ];
  const titles: AsinTitleRow[] = [
    { asin: "B01", title: "   ", preferred: false },
    { asin: "B01", title: "标题A", preferred: false },
    { asin: "B01", title: "catalog 标题", preferred: true },
  ];
  const images: AsinImageRow[] = [{ asin: "B01", fileId: "file-1" }];
  const orders: SkuOrderRow[] = [
    { sellerSku: "SKU-1", orderCount: 4, saleQuantity: 9 },
    { sellerSku: "SKU-2", orderCount: 1, saleQuantity: 1 },
  ];
  const rows = buildSellerCatalogItems(catalog, inv, titles, images, orders);
  assert.equal(rows.length, 4); // 4 个唯一 SKU（重复 SKU-1 去重）
  const a = rows.find((r) => r.sellerSku === "SKU-1")!;
  assert.equal(a.asin, "B01");
  assert.equal(a.title, "catalog 标题"); // preferred 覆盖，空标题忽略
  assert.equal(a.imageFileId, "file-1");
  assert.equal(a.listingStatus, "ACTIVE");
  assert.equal(a.fulfillmentType, "FBA");
  assert.equal(a.available, 5);
  assert.equal(a.inbound, 3);
  assert.equal(a.reserved, 1);
  assert.equal(a.unfulfillable, 0);
  assert.equal(a.saleQuantity, 9);
  assert.equal(a.orderCount, 4);
  const b = rows.find((r) => r.sellerSku === "SKU-1B")!;
  assert.equal(b.available, null); // 库存快照无此 SKU，留 null 不补 0
  assert.equal(b.saleQuantity, 0); // 无订单留 0
  assert.equal(b.listingStatus, "INACTIVE");
  const noAsin = rows.find((r) => r.sellerSku === "NO-ASIN")!;
  assert.equal(noAsin.title, ""); // 无 ASIN 不关联标题，不臆造
  assert.equal(noAsin.imageFileId, null);
});

test("sales basis text states order-basis, not daily snapshot", () => {
  assert.match(SALES_BASIS, /订单商品表/);
  assert.match(SALES_BASIS, /不是按日销量快照/);
  assert.match(SALES_BASIS, /Seller SKU/);
});

test("API routes keep response body as plain object and never spread a Response", () => {
  for (const rel of [
    "src/app/api/amazon/catalog-workbench/route.ts",
    "src/app/api/amazon/catalog-workbench/items/route.ts",
  ]) {
    const source = readFileSync(path.join(root, rel), "utf8").replace(/\/\/.*$/gm, "");
    const m = source.match(/const body = await read[\s\S]*?;\s*return NextResponse\.json\(\{ \.\.\.body/);
    assert.ok(m, `${rel} 必须 await 数据层后用普通对象 body 展开进 NextResponse.json`);
    assert.ok(!/return NextResponse\.json\(\{\s*\.\.\.result\.body/.test(source));
  }
});
