import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import type { Product } from "@/lib/products/types";
import { createProductListResponseCacheKey } from "@/lib/products/product-list-cache";
import {
  buildProductExportPayload,
  buildProductExportWhere,
  buildProductExportWorkbook,
  createProductExportFileName,
  createProductExportStorageKey,
} from "@/lib/products/product-export-job";

function createProduct(overrides: Partial<Product> = {}) {
  return {
    id: "product-1",
    sku: "SKU/ONE:测试",
    chineseName: "测试商品",
    englishName: "Test Product",
    image: "",
    asin: "B000000001",
    developer: "张三",
    purchasePrice: 3.5,
    status: "pending",
    supplierName: "测试供应商",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "7天",
    keywords: "resistance band, fitness",
    note: "测试备注",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: ["B000000002"],
    productWeightG: 500,
    packageWeightG: 650,
    productSizeCm: { length: 20, width: 10, height: 5 },
    packageSizeCm: { length: 22, width: 12, height: 6 },
    ...overrides,
  } as Product;
}

test("product export creates one formatted worksheet per SKU", async () => {
  const buffer = await buildProductExportWorkbook([
    createProduct(),
    createProduct({ id: "product-2", sku: "SKU-TWO" }),
  ]);
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["SKU_ONE_测试", "SKU-TWO"]);
  assert.equal(workbook.worksheets[0].getCell("A1").value, "品名");
  assert.deepEqual(workbook.worksheets[0].getCell("F2").value, {
    formula: 'IF($A2="","",B2*C2*D2/6000)',
  });
  assert.equal(workbook.worksheets[0].getCell("A11").value, "多套装组合");
  assert.equal(workbook.worksheets[0].getCell("A28").value, "产品改进点");
  assert.equal(workbook.worksheets[0].getCell("A33").value, "关键词");
});

test("product export uses xlsx names and storage keys", () => {
  const now = new Date("2026-09-14T00:00:00.000Z");

  assert.equal(createProductExportFileName(now), "products-2026-09-14.xlsx");
  assert.match(createProductExportStorageKey(now), /^exports\/products\/2026-09-14\/.+\.xlsx$/);
});

test("SKU 0000 pricing rows use product name plus pack counts", async () => {
  const product = createProduct({
    sku: "0000",
    chineseName: "SKU: 0000 | 2PCS",
  }) as Product & { workbookDetail?: unknown };
  product.workbookDetail = {
    title: "PVC透明麻将将垫收纳管",
    pricingRows: [
      { name: "普通规格", lengthCm: 10, widthCm: 10, heightCm: 5, actualWeightKg: 0.1, suggestedPrice: 10, purchaseCost: 2, oceanFreightUnitPrice: 12, fbaFee: 3, exchangeRate: 6.8 },
      { name: "大包装", lengthCm: 10, widthCm: 10, heightCm: 5, actualWeightKg: 0.2, suggestedPrice: 15, purchaseCost: 3, oceanFreightUnitPrice: 12, fbaFee: 4, exchangeRate: 6.8 },
    ],
  };
  const buffer = await buildProductExportWorkbook([
    product,
  ]);
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  assert.equal(workbook.worksheets[0].getCell("A2").value, "PVC透明麻将将垫收纳管+2pcs");
  assert.equal(workbook.worksheets[0].getCell("A3").value, "PVC透明麻将将垫收纳管+4pcs");
});

test("my SKU export filters by the creating user's id", () => {
  const url = new URL("https://example.com/api/products/export?createdByMe=true");
  const payload = buildProductExportPayload(url);
  const where = buildProductExportWhere({
    user: { organizationId: "org-1", id: "user-super-admin" },
    workspaceId: "workspace-1",
    payload,
  });

  assert.equal(payload.createdByMe, true);
  assert.deepEqual(where.AND, [{ productRecord: { userId: "user-super-admin" } }]);
});

test("my SKU list cache keys are isolated by creating user", () => {
  const input = {
    scopeKey: "org-1:workspace-1:dashboard" as const,
    page: 1,
    pageSize: 20,
    createdByMe: true,
    detail: false,
    includeSummary: false,
    opsAssignees: [],
    selectionOwners: [],
    designerAssignees: [],
  };

  assert.notEqual(
    createProductListResponseCacheKey({ ...input, createdByUserId: "user-1" }),
    createProductListResponseCacheKey({ ...input, createdByUserId: "user-2" }),
  );
});
