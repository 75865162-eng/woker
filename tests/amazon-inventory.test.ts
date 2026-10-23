import assert from "node:assert/strict";
import test from "node:test";
import { extractAmazonInventorySnapshots, resolveAmazonMarketplaceId } from "@/lib/amazon/inventory";

const quantities = { fulfillableQuantity: 8, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0, reservedQuantity: 3, unfulfillableQuantity: 0, researchingQuantity: 0 };

test("Amazon inventory extraction keeps valid SKU rows and exact quantities", () => {
  const snapshots = extractAmazonInventorySnapshots({
    inventorySummaries: [
      {
        sellerSku: "SKU-1",
        asin: "B001",
        fnSku: "FNSKU1",
        condition: "NewItem",
        inventoryDetails: quantities,
      },
      { sellerSku: "SKU-1", condition: "NewItem", inventoryDetails: { fulfillableQuantity: 99 } },
      { sellerSku: "", inventoryDetails: { fulfillableQuantity: 10 } },
    ],
  });

  assert.deepEqual(snapshots, [{
    sellerSku: "SKU-1", asin: "B001", fnSku: "FNSKU1", condition: "NewItem",
    fulfillableQuantity: 8, inboundWorkingQuantity: 0, inboundShippedQuantity: 0, inboundReceivingQuantity: 0,
    reservedQuantity: 3, unfulfillableQuantity: 0, researchingQuantity: 0,
  }]);
});

test("Amazon marketplace resolution requires one verified marketplace", () => {
  const participations = [{ marketplaceId: "ATVPDKIKX0DER", countryCode: "US", name: "Amazon.com", domainName: "www.amazon.com" }];
  assert.equal(resolveAmazonMarketplaceId("US", participations), "ATVPDKIKX0DER");
  assert.equal(resolveAmazonMarketplaceId("ATVPDKIKX0DER", participations), "ATVPDKIKX0DER");
  assert.throws(() => resolveAmazonMarketplaceId("DE", participations), /未匹配/);
});

test("official payload envelope and nested quantity totals are parsed without losing stock", () => {
  const rows = extractAmazonInventorySnapshots({ payload: { inventorySummaries: [{ sellerSku: "SKU", inventoryDetails: { ...quantities, fulfillableQuantity: 4, reservedQuantity: { totalReservedQuantity: 6 }, unfulfillableQuantity: { totalUnfulfillableQuantity: 2 }, researchingQuantity: { totalResearchingQuantity: 1 } } }] } });
  assert.equal(rows[0].reservedQuantity, 6); assert.equal(rows[0].unfulfillableQuantity, 2); assert.equal(rows[0].researchingQuantity, 1);
  assert.throws(() => extractAmazonInventorySnapshots({ payload: {} }), /不能视为空快照成功/);
});

test("incomplete or invalid inventory quantities fail instead of fabricating zero stock", () => {
  for (const field of Object.keys(quantities)) {
    for (const invalid of [undefined, null, "0", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => extractAmazonInventorySnapshots({ payload: { inventorySummaries: [{ sellerSku: "SKU", inventoryDetails: { ...quantities, [field]: invalid } }] } }), /不能补零/);
    }
  }
  assert.throws(() => extractAmazonInventorySnapshots({ inventorySummaries: [{ sellerSku: "SKU" }] }), /不能补零/);
  assert.deepEqual(extractAmazonInventorySnapshots({ inventorySummaries: [] }), []);
  const zeros = Object.fromEntries(Object.keys(quantities).map((key) => [key, 0]));
  assert.equal(extractAmazonInventorySnapshots({ inventorySummaries: [{ sellerSku: "SKU", inventoryDetails: zeros }] })[0].fulfillableQuantity, 0);
});
