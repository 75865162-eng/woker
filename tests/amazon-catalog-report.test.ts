import assert from "node:assert/strict";
import test from "node:test";
import { parseAllListingsReport } from "@/lib/amazon-sync/catalog-report";

test("all listings report accepts BOM, quoted cells and maps only the catalog snapshot fields", () => {
  const rows = parseAllListingsReport("\uFEFFseller-sku\tasin1\tstatus\tfulfillment-channel\titem-name\nSKU-1\tB012345678\tActive\tAMAZON_NA\t\"Product\tname\"\n");
  assert.deepEqual(rows, [{ sellerSku: "SKU-1", asin: "B012345678", listingStatus: "Active", fulfillmentType: "AMAZON_NA" }]);
});

test("all listings report rejects missing identity, conflicting duplicate SKUs and invalid ASINs", () => {
  assert.throws(() => parseAllListingsReport("status\nActive\n"), /表头/);
  assert.throws(() => parseAllListingsReport("seller-sku\tasin1\nSKU-1\tB012345678\nSKU-1\tB987654321\n"), /冲突/);
  assert.throws(() => parseAllListingsReport("seller-sku\tasin1\nSKU-1\tbad\n"), /业务键无效/);
});
