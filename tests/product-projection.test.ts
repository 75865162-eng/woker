import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductSummaryProjection,
  buildProductTextProjection,
  productProjectionNames,
  shouldApplyProjectionRevision,
} from "@/lib/products/product-projection";
import { createProductListingKey } from "@/lib/products/product-center-projection";
import { resolveProjectionFailureRevision } from "@/lib/products/product-outbox";
import type { Product } from "@/lib/products/types";

const product = {
  id: "product-1",
  sku: "SKU-1",
  chineseName: "测试商品",
  englishName: "Test product",
  asin: "B000000001",
  developer: "选品员",
  purchasePrice: 12.5,
  status: "developing",
  source: "dashboard",
  supplierName: "供应商",
  supplierUrl: "https://supplier.example",
  specs: "规格",
  purchaseLeadTime: "7天",
  keywords: "关键词",
  note: "备注",
  cancelReason: "",
  hsCode: "1234",
  images: [],
  imageAssets: [{
    id: "asset-1",
    name: "hero.webp",
    mimeType: "image/webp",
    size: 100,
    storageType: "local",
    uploadedAt: "2026-09-10T00:00:00.000Z",
    thumbUrl: "/thumb.webp",
    originalUrl: "/original.webp",
  }],
  competitorAsins: [],
  productWeightG: 100,
  packageWeightG: 120,
  productSizeCm: { length: 1, width: 2, height: 3 },
  packageSizeCm: { length: 2, width: 3, height: 4 },
  selectionOwner: "选品员",
  opsAssignee: "运营",
  designerAssignee: "美工",
  workflowStage: "ops_confirming",
  workflowDueAt: "2026-09-11T00:00:00.000Z",
} as unknown as Product;

test("product summary projection contains only list-facing fields", () => {
  const result = buildProductSummaryProjection({
    product,
    organizationId: "org-1",
    workspaceId: "workspace-1",
    accountId: "account-1",
    marketplace: "US",
    sourceRevision: 4,
    sourceCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
    sourceUpdatedAt: new Date("2026-09-10T00:00:00.000Z"),
  });

  assert.equal(result.productRecordId, "product-1");
  assert.equal(result.primaryImageUrl, "/thumb.webp");
  assert.equal(result.sourceRevision, 4);
  assert.equal(result.createdAt.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(result.projectionVersion, 1);
  assert.equal("payload" in result, false);
  assert.equal("specs" in result, false);
});

test("product summary projection keeps the persisted thumbnail as the list image", () => {
  const result = buildProductSummaryProjection({
    product: {
      ...product,
      imageAssets: [{
        id: "asset-1",
        name: "hero.webp",
        mimeType: "image/webp",
        size: 100,
        storageType: "local",
        uploadedAt: "2026-09-10T00:00:00.000Z",
        thumbUrl: "",
        thumbFileId: "thumb-file-1",
        originalUrl: "/original.webp",
      }],
    },
    organizationId: "org-1",
    workspaceId: "workspace-1",
    accountId: "account-1",
    marketplace: "US",
    sourceRevision: 5,
  });

  assert.equal(result.primaryImageUrl, "/api/products/file-assets/thumb-file-1/download");
});

test("summary overdue derivation uses the ProductRecord creation time", () => {
  const result = buildProductSummaryProjection({
    product: {
      ...product,
      workflowDueAt: "",
      createdAt: "2020-09-14T00:00:00.000Z",
    },
    organizationId: "org-1",
    workspaceId: "workspace-1",
    accountId: "account-1",
    marketplace: "US",
    sourceRevision: 4,
    sourceCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
  });

  assert.equal(result.isOverdue, true);
});

test("product text projection owns long-form product text", () => {
  const result = buildProductTextProjection({
    product,
    organizationId: "org-1",
    workspaceId: "workspace-1",
    sourceRevision: 4,
  });

  assert.equal(result.specs, "规格");
  assert.equal(result.keywords, "关键词");
  assert.equal(result.note, "备注");
  assert.equal(result.language, "default");
  assert.equal(result.sourceRevision, 4);
});

test("projection revision guard rejects stale writes and accepts equal revisions idempotently", () => {
  assert.equal(shouldApplyProjectionRevision(5, 4), false);
  assert.equal(shouldApplyProjectionRevision(5, 5), true);
  assert.equal(shouldApplyProjectionRevision(5, 6), true);
  assert.equal(shouldApplyProjectionRevision(null, 1), true);
});

test("projection failures use the revision actually processed, not the stale event revision", () => {
  assert.equal(resolveProjectionFailureRevision({ currentRevision: 3, eventRevision: 2 }), 3);
  assert.equal(resolveProjectionFailureRevision({ currentRevision: null, eventRevision: 2 }), 2);
});

test("product center is part of the projection contract", () => {
  assert.deepEqual(productProjectionNames, ["summary", "text", "list_summary", "product_center"]);
});

test("product listing key is normalized and stable across projection retries", () => {
  assert.equal(
    createProductListingKey({
      accountId: " account-1 ",
      marketplace: "us",
      sku: "SKU-1",
    }),
    "account-1:US:SKU-1",
  );
  assert.equal(
    createProductListingKey({
      accountId: "",
      marketplace: "",
      sku: "SKU-1",
    }),
    "default-account:default-marketplace:SKU-1",
  );
});
