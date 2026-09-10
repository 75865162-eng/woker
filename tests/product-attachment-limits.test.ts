import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";
import { ensureProductAttachmentFileName } from "@/lib/products/image-assets";

test("product attachments use a 10 MB limit", () => {
  assert.equal(PRODUCT_ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024);
});

test("oversized attachment errors include the file name and size", () => {
  const message = productAttachmentSizeError("evidence.pdf", 11 * 1024 * 1024);

  assert.match(message, /evidence\.pdf/);
  assert.match(message, /11\.0 MB/);
  assert.match(message, /10 MB/);
});

test("data URL attachment names receive an extension from their MIME type", () => {
  assert.equal(ensureProductAttachmentFileName("SKU-image-1", "image/png"), "SKU-image-1.png");
  assert.equal(ensureProductAttachmentFileName("SKU-image-2", "image/webp"), "SKU-image-2.webp");
  assert.equal(ensureProductAttachmentFileName("evidence.pdf", "application/pdf"), "evidence.pdf");
});
