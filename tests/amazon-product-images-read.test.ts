import assert from "node:assert/strict";
import test from "node:test";
import { imageSellerPredicate, readAccessibleProductImage, readProductImageReferences } from "@/lib/operations/amazon-product-images";

test("image seller predicates deny empty grants and parameterize seller/site boundaries", () => {
  assert.equal(imageSellerPredicate({ allSellers: false, sellerIds: [] }).text, "FALSE");
  assert.equal(imageSellerPredicate({ allSellers: true, sellerIds: [] }).text, "TRUE");
  const query = imageSellerPredicate({ allSellers: false, sellerIds: ["seller-a"], scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["site-a"] }] });
  assert.deepEqual(query.values, ["seller-a", "seller-a", "site-a"]);
  assert.ok(!query.text.includes("seller-a"));
  assert.match(query.text, /marketplaceId/);
  assert.equal(imageSellerPredicate({ allSellers: false, sellerIds: ["seller-a"], scopes: [] }).text, "FALSE");
});

test("image reads support a cached client without newly generated model delegates", async () => {
  const globalDb = globalThis as unknown as { prisma?: unknown };
  const previous = globalDb.prisma;
  const queries: Array<{ text: string; values: unknown[] }> = [];
  globalDb.prisma = { $queryRaw: async (query: { text: string; values: unknown[] }) => { queries.push(query); return [{ fileId: "shared-file" }]; } };
  try {
    const scope = { organizationId: "org-a", workspaceId: "workspace-a" };
    assert.deepEqual(await readProductImageReferences(scope, []), []);
    assert.equal(queries.length, 0);
    const result = await readProductImageReferences(scope, [{ sellerAccountId: "seller-a", marketplaceId: "site-a", asin: "B000000001" }]);
    assert.equal(result[0].fileId, "shared-file");
    assert.deepEqual(queries[0].values, ["org-a", "workspace-a", "seller-a", "site-a", "B000000001"]);
    assert.match(queries[0].text, /f."organizationId" = b."organizationId"/);
    await readAccessibleProductImage(scope, "shared-file", { allSellers: false, sellerIds: ["seller-a"], scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["site-a"] }] });
    assert.deepEqual(queries[1].values, ["org-a", "workspace-a", "shared-file", "seller-a", "seller-a", "site-a"]);
    assert.match(queries[1].text, /EXISTS/);
    await assert.rejects(readProductImageReferences(scope, Array.from({ length: 4001 }, () => ({ sellerAccountId: "s", marketplaceId: "m", asin: "B000000001" }))), /page limit/);
  } finally { globalDb.prisma = previous; }
});
