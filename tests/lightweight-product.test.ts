import assert from "node:assert/strict";
import test from "node:test";
import { toLightweightProduct } from "@/lib/products/lightweight-product";
import type { Product } from "@/lib/products/types";

test("lightweight product responses keep text and thumbnails but remove heavy asset content", () => {
  const product = {
    id: "prod-1",
    sku: "SKU-1",
    chineseName: "测试商品",
    englishName: "Test product",
    image: "data:image/png;base64,heavy",
    images: ["data:image/png;base64,heavy"],
    imageAssets: [{
      id: "file-image-1",
      name: "hero.png",
      mimeType: "image/png",
      size: 123,
      storageType: "local",
      uploadedAt: "2026-09-10T00:00:00.000Z",
      thumbUrl: "/api/assets/thumb.webp",
      originalUrl: "/api/assets/original.png",
    }],
    operationsProgress: {
      stages: [{
        id: "image_request",
        status: "completed",
        owner: "",
        plannedAt: "",
        completedAt: "",
        note: "文本保留",
        updatedAt: "",
        evidenceFile: {
          fileId: "file-pdf-1",
          fileName: "说明.pdf",
          fileType: "application/pdf",
          fileSize: 456,
          downloadUrl: "/api/products/file-assets/file-pdf-1/download",
          fileDataUrl: "data:application/pdf;base64,heavy",
          uploadedAt: "2026-09-10T00:00:00.000Z",
        },
      }],
    },
    workbookDetail: {
      remarkImages: ["/legacy/pdf-url"],
      remarkImageAssets: [{
        id: "file-pdf-1",
        name: "说明.pdf",
        mimeType: "application/pdf",
        size: 456,
        storageType: "local",
        uploadedAt: "2026-09-10T00:00:00.000Z",
        thumbUrl: "/legacy/pdf-url",
        originalUrl: "/legacy/pdf-url",
        downloadUrl: "/api/products/file-assets/file-pdf-1/download",
      }],
      competitors: [],
    },
  } as unknown as Product;

  const result = toLightweightProduct(product);
  const resultWithWorkbook = result as Product & {
    workbookDetail?: {
      remarkImages?: string[];
      remarkImageAssets?: Array<{ name?: string; thumbUrl?: string }>;
    };
  };

  assert.equal(result.chineseName, "测试商品");
  assert.equal(result.image, "/api/assets/thumb.webp");
  assert.deepEqual(result.images, ["/api/assets/thumb.webp"]);
  assert.equal(result.imageAssets?.[0]?.originalUrl, "");
  assert.equal(result.imageAssets?.[0]?.thumbUrl, "/api/assets/thumb.webp");
  assert.equal(result.operationsProgress?.stages[0]?.evidenceFile?.fileDataUrl, undefined);
  assert.equal(result.operationsProgress?.stages[0]?.evidenceFile?.downloadUrl, "/api/products/file-assets/file-pdf-1/download");
  assert.equal(resultWithWorkbook.workbookDetail?.remarkImages?.length, 1);
  assert.equal(resultWithWorkbook.workbookDetail?.remarkImageAssets?.[0]?.name, "说明.pdf");
  assert.equal(resultWithWorkbook.workbookDetail?.remarkImageAssets?.[0]?.thumbUrl, "");
});

test("lightweight image assets fall back to a protected file download when no thumbnail exists", () => {
  const result = toLightweightProduct({
    id: "prod-2",
    sku: "SKU-2",
    chineseName: "旧商品",
    englishName: "",
    imageAssets: [{
      id: "legacy-image-1",
      name: "legacy.png",
      mimeType: "image/png",
      size: 100,
      storageType: "local",
      uploadedAt: "",
      thumbUrl: "",
      originalUrl: "data:image/png;base64,legacy",
    }],
  } as unknown as Product);

  assert.equal(result.imageAssets?.[0]?.thumbUrl, "/api/products/file-assets/legacy-image-1/download");
  assert.equal(result.imageAssets?.[0]?.originalUrl, "");
});
