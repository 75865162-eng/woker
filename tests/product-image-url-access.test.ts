import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthorizedProductImageFiles, normalizeProductImageFileIds } from "@/lib/products/image-url-access";

test("product image signing accepts a bounded, de-duplicated batch", () => {
  assert.deepEqual(normalizeProductImageFileIds(["file-1", " file-2 ", "file-1"], 100), ["file-1", "file-2"]);
  assert.deepEqual(normalizeProductImageFileIds(Array.from({ length: 101 }, (_, index) => `file-${index}`), 100), []);
});

test("product image signing rejects a batch with an unavailable file", () => {
  assert.equal(hasAuthorizedProductImageFiles(["file-1", "file-2"], ["file-1", "file-2"]), true);
  assert.equal(hasAuthorizedProductImageFiles(["file-1", "file-2"], ["file-1"]), false);
});
