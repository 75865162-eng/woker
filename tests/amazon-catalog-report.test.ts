import assert from "node:assert/strict";
import test from "node:test";
import { parseAllListingsReport } from "@/lib/amazon-sync/catalog-report";

test("all listings preserves inch quotes inside unquoted product names", () => {
  const rows = parseAllListingsReport('seller-sku\tasin1\titem-name\nSKU-1\tB012345678\tWidget 12" size\n');
  assert.equal(rows[0].listingAttributes?.itemName, 'Widget 12" size');
});

test("all listings report accepts BOM, quoted cells and maps whitelisted catalog fields", () => {
  const rows = parseAllListingsReport("\uFEFFseller-sku\tasin1\tstatus\tfulfillment-channel\titem-name\tprice\tquantity\titem-note\nSKU-1\tB012345678\tActive\tAMAZON_NA\t\"Product\tname\"\t19.9900\t03\tprivate fixture note\n");
  assert.deepEqual(rows, [{ sellerSku: "SKU-1", asin: "B012345678", listingStatus: "Active", fulfillmentType: "AMAZON_NA", listingAttributes: { listingId: null, productId: null, productIdType: null, itemName: "Product\tname", itemCondition: null, price: "19.9900", quantity: "03", openDate: null, merchantShippingGroup: null, itemIsMarketplace: null } }]);
  assert.ok(!JSON.stringify(rows).includes("private fixture note"));
});

test("all listings report rejects missing identity, conflicting duplicate SKUs and invalid ASINs", () => {
  assert.throws(() => parseAllListingsReport("status\nActive\n"), /表头/);
  assert.throws(() => parseAllListingsReport("seller-sku\tasin1\nSKU-1\tB012345678\nSKU-1\tB987654321\n"), /冲突/);
  assert.throws(() => parseAllListingsReport("seller-sku\tasin1\nSKU-1\tbad\n"), /业务键无效/);
  assert.throws(() => parseAllListingsReport(`seller-sku\tasin1\titem-name\nSKU-1\tB012345678\t${"x".repeat(2001)}\n`), /属性字段无效/);
});


test("Listing API summary maps only bounded target-marketplace attributes and retains missing data", async () => {
  const { extractCatalogPage } = await import("@/lib/amazon/catalog");
  const result = extractCatalogPage({ items: [{ sku: "SKU", summaries: [
    { marketplaceId: "CA", itemName: "Other site", productType: "OTHER" },
    { marketplaceId: "US", asin: "B012345678", itemName: "  Name  ", productType: "HOME", conditionType: "new_new", privateNote: "PRIVATE" },
  ], attributes: { email: "PRIVATE", price: "99" } }, { sku: "MISSING", summaries: [{ marketplaceId: "US", itemName: null }] }] }, "US");
  assert.deepEqual(result.items[0].listingAttributes, { itemName: "Name", productType: "HOME", conditionType: "new_new" });
  assert.deepEqual(result.items[1].listingAttributes, { itemName: null });
  assert.ok(!/Other site|PRIVATE|email|price/.test(JSON.stringify(result)));
  assert.equal(extractCatalogPage({ items: [{ sku: "OLD", summaries: [{ marketplaceId: "US" }] }] }, "US").items[0].listingAttributes, undefined);
  for (const itemName of [123, {}, "x".repeat(2001), "bad\u0000name"]) assert.throws(() => extractCatalogPage({ items: [{ sku: "SKU", summaries: [{ marketplaceId: "US", itemName }] }] }, "US"), /摘要属性无效/);
});

test("Listing summary mapping catalogue records the executable JSON transform without claiming other fields", async () => {
  const { implementedFieldMapping } = await import("@/lib/amazon-sync/field-mappings");
  for (const key of ["itemName", "productType", "conditionType"]) {
    const mapping = implementedFieldMapping("catalog", "searchListingsItems", "2021-08-01", `/items/*/summaries/*/${key}`);
    assert.equal(mapping?.targetTable, "AmazonCatalogSnapshot"); assert.equal(mapping?.targetColumn, "listingAttributes");
    assert.ok(mapping?.transform.includes(`listingAttributes.${key}`));
  }
  assert.equal(implementedFieldMapping("catalog", "searchListingsItems", "2021-08-01", "/items/*/attributes/price"), null);
});
