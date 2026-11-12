import assert from "node:assert/strict";
import test from "node:test";
import { defaultProductListSort, normalizeProductListSort } from "@/lib/products/list-sort";
import { createProductListResponseCacheKey } from "@/lib/products/product-list-cache";

test("product list sort accepts only supported fields and directions", () => {
  assert.deepEqual(normalizeProductListSort("purchasePrice", "asc"), { field: "purchasePrice", direction: "asc" });
  assert.deepEqual(normalizeProductListSort("untrusted SQL", "asc; DROP TABLE"), defaultProductListSort);
  assert.deepEqual(normalizeProductListSort(null, null), defaultProductListSort);
});

test("product list cache separates sort order while retaining the legacy default key", () => {
  const base = { scopeKey: "org:workspace:all", page: 1, pageSize: 20, opsAssignees: [], selectionOwners: [], designerAssignees: [], detail: false, includeSummary: true };
  const defaultKey = createProductListResponseCacheKey(base);
  assert.equal(defaultKey, createProductListResponseCacheKey({ ...base, sort: defaultProductListSort }));
  assert.notEqual(defaultKey, createProductListResponseCacheKey({ ...base, sort: { field: "sku", direction: "asc" } }));
});
