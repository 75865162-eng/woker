import assert from "node:assert/strict";
import test from "node:test";
import { collectProductAttachmentReferences, hasInlineProductAttachmentData } from "@/lib/products/attachment-bindings";
import type { Product } from "@/lib/products/types";

test("product attachment references include persisted file ids and skip placeholder ids", () => {
  const product = {
    id: "prod-1",
    sku: "SKU-1",
    imageAssets: [{
      id: "file-image-1",
      thumbFileId: "file-image-thumb-1",
      name: "hero.png",
      mimeType: "image/png",
      thumbUrl: "/thumb",
      originalUrl: "/original",
    }],
    workbookDetail: {
      remarkImageAssets: [{
        id: "product-image-1",
        name: "legacy.png",
        mimeType: "image/png",
        thumbUrl: "/legacy",
        originalUrl: "/legacy",
      }],
    },
    operationsProgress: {
      stages: [{
        evidenceFile: {
          fileId: "file-evidence-1",
          fileName: "evidence.xlsx",
          fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      }],
    },
  } as unknown as Product;

  assert.deepEqual(
    collectProductAttachmentReferences(product).map((reference) => reference.fileId).sort(),
    ["file-evidence-1", "file-image-1", "file-image-thumb-1"],
  );
});

test("inline attachment data is detected for legacy migration visibility", () => {
  assert.equal(hasInlineProductAttachmentData({ image: "data:image/png;base64,abc" }), true);
  assert.equal(hasInlineProductAttachmentData({ evidenceFile: { fileDataUrl: "data:application/pdf;base64,abc" } }), true);
});
