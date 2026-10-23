import assert from "node:assert/strict";
import test from "node:test";
import { extractAmazonInventorySnapshots, resolveAmazonMarketplaceId } from "@/lib/amazon/inventory";

test("Amazon inventory extraction keeps only valid SKU rows and normalizes quantities", () => {
  const snapshots = extractAmazonInventorySnapshots({
    inventorySummaries: [
      {
        sellerSku: "SKU-1",
        asin: "B001",
        fnSku: "FNSKU1",
        condition: "NewItem",
        inventoryDetails: { fulfillableQuantity: 8.8, inboundWorkingQuantity: -1, reservedQuantity: "3" },
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
