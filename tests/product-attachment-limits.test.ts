import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";

test("product attachments use a 10 MB limit", () => {
  assert.equal(PRODUCT_ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
});

test("oversized attachment errors include the file name and size", () => {
  const message = productAttachmentSizeError("evidence.pdf", 11 * 1024 * 1024);

  assert.match(message, /evidence\.pdf/);
  assert.match(message, /11\.0 MB/);
  assert.match(message, /10 MB/);
});
