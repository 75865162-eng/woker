import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db/prisma";
import { buildProductRecordIndex } from "@/lib/products/product-record-index";
import { isIgnoredProductSku } from "@/lib/products/sku-utils";
import { getStorageDriver, getStorageType } from "@/lib/storage";
import type { Product, ProductSourceImageAsset, ProductSourceWorkbook, ProductSourceWorkbookRow, ProductStatus } from "@/lib/products/types";
import { buildWorkflowEvent, createWorkflowDueAt } from "@/lib/products/workflow";

type CommodityImportScope = {
  organizationId: string;
  userId: string;
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

type CommodityImportResult = {
  importedCount: number;
  imageDownloadedCount: number;
  imageFailedCount: number;
  skippedRowCount: number;
};

type CommodityImportOptions = CommodityImportScope & {
  fileName: string;
  workbookBuffer: ArrayBuffer;
  onProgress?: (progress: number) => Promise<void>;
};

const commoditySheetName = "商品";
const supplierQuoteSheetName = "更多供应商报价";
const countryFreightSheetName = "按国家维护头程费用";
const visibleSheets = [commoditySheetName, supplierQuoteSheetName, countryFreightSheetName];

const commodityFieldAliases = {
  sku: ["*SKU", "SKU"],
  name: ["*品名", "品名"],
  status: ["状态"],
  material: ["材质"],
  model: ["型号"],
  use: ["用途"],
  developer: ["开发员"],
  viewer: ["查看人"],
  imageUrl: ["图片链接"],
  purchaseCost: ["采购成本(CNY)", "采购成本(￥)"],
  purchaseLeadTime: ["采购交期"],
  purchaseNote: ["采购备注"],
  minPurchaseQuantity: ["最低采购量", "最小采购量"],
  productNote: ["商品备注"],
  customsEnglishName: ["英文报关名"],
  customsWeightG: ["报关重量(g)"],
  hsCode: ["海关编码", "HS Code"],
  productLengthCm: ["商品尺寸长(cm)", "商品规格长(cm)"],
  productWidthCm: ["商品尺寸宽(cm)", "商品规格宽(cm)"],
  productHeightCm: ["商品尺寸高(cm)", "商品规格高(cm)"],
  productWeight: ["商品重量"],
  productWeightUnit: ["商品重量单位"],
  packageLengthCm: ["商品包装规格长(cm)"],
  packageWidthCm: ["商品包装规格宽(cm)"],
  packageHeightCm: ["商品包装规格高(cm)"],
  packageWeight: ["商品包装重量"],
  packageWeightUnit: ["商品包装重量单位"],
  supplierName: ["首选供应商名称", "供应商名称"],
  taxRate: ["税率"],
  purchasePrice: ["采购单价"],
  purchaseUrl: ["采购链接"],
  quote20: ["报价（20套）"],
  supplierProductUrl: ["供应商产品链接"],
  quoteNote: ["报价备注"],
  developmentDate: ["开发时间", "创建时间"],
} satisfies Record<string, string[]>;

const mappedFields = Array.from(new Set(Object.values(commodityFieldAliases).flat()));

const commodityStatusMap: Record<string, ProductStatus> = {
  开发中: "developing",
  待售: "listing_confirming",
  在售: "listed",
  清仓: "developing",
  停售: "delisted",
};

const supportedImageTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const contentTypeExtensions: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const maxAssetSize = 50 * 1024 * 1024;
const imageDownloadConcurrency = 6;

export async function importCommodityWorkbook(options: CommodityImportOptions): Promise<CommodityImportResult> {
  const workbook = XLSX.read(options.workbookBuffer, { cellDates: true });
  const commoditySheet = workbook.Sheets[commoditySheetName] ?? workbook.Sheets[workbook.SheetNames[0]];

  if (!commoditySheet) {
    throw new Error("Excel 文件没有可读取的商品工作表。");
  }

  const headersBySheet: Record<string, string[]> = {};
  const rowsBySkuBySheet = new Map<string, Map<string, ProductSourceWorkbookRow[]>>();

  visibleSheets.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = sheet ? XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false }) : [];
    const headers = normalizeHeaders(rows[0] ?? []);
    headersBySheet[sheetName] = headers;

    const skuColumn = findColumnIndexByAliases(headers, commodityFieldAliases.sku);
    if (skuColumn < 0) return;

    rows.slice(1).forEach((row, index) => {
      if (!row.some((cell) => cleanText(cell))) return;
      const sku = cleanText(row[skuColumn]);
      if (!sku || isIgnoredProductSku(sku)) return;

      const bySheet = rowsBySkuBySheet.get(sku) ?? new Map<string, ProductSourceWorkbookRow[]>();
      const sheetRows = bySheet.get(sheetName) ?? [];
      sheetRows.push({ rowNumber: index + 2, values: rowToRecord(headers, row) });
      bySheet.set(sheetName, sheetRows);
      rowsBySkuBySheet.set(sku, bySheet);
    });
  });

  const commodityRows = XLSX.utils.sheet_to_json<string[]>(commoditySheet, { header: 1, defval: "", raw: false, blankrows: false });
  const commodityHeaders = normalizeHeaders(commodityRows[0] ?? []);

  if (!isCommodityWorkbookHeader(commodityHeaders)) {
    throw new Error("未识别到商品导入模板表头。");
  }

  let importedCount = 0;
  let skippedRowCount = 0;
  let imageDownloadedCount = 0;
  let imageFailedCount = 0;
  const rows = commodityRows.slice(1).filter((row) => row.some((cell) => cleanText(cell)));

  await options.onProgress?.(20);

  let completedRowCount = 0;
  async function reportRowCompleted() {
    completedRowCount += 1;

    if (completedRowCount % 25 === 0 || completedRowCount === rows.length) {
      const progress = rows.length ? 20 + Math.round((completedRowCount / rows.length) * 75) : 95;
      await options.onProgress?.(Math.min(progress, 95));
    }
  }

  await runWithConcurrency(rows, imageDownloadConcurrency, async (row) => {
    const record = rowToRecord(commodityHeaders, row);
    const sku = readCommodityRecord(record, "sku");
    const name = readCommodityRecord(record, "name");

    if (!sku || !name || isIgnoredProductSku(sku)) {
      skippedRowCount += 1;
      await reportRowCompleted();
      return;
    }

    const sourceWorkbook = buildSourceWorkbook(options.fileName, sku, headersBySheet, rowsBySkuBySheet, record);
    const product = buildProductFromCommodityRecord(record, sourceWorkbook);
    const productWithImage = await hydrateProductMainImage(product, options);
    const productIndex = buildProductRecordIndex(productWithImage);
    const imageAsset = productWithImage.sourceWorkbook?.imageAssets?.at(-1);

    if (imageAsset?.status === "downloaded") imageDownloadedCount += 1;
    if (imageAsset?.status === "failed") imageFailedCount += 1;

    await prisma.productRecord.upsert({
      where: {
        organizationId_workspaceId_sku: {
          organizationId: options.organizationId,
          workspaceId: options.workspaceId,
          sku: productWithImage.sku,
        },
      },
      create: {
        id: randomUUID(),
        organizationId: options.organizationId,
        userId: options.userId,
        workspaceId: options.workspaceId,
        accountId: options.accountId,
        marketplace: options.marketplace,
        sku: productWithImage.sku,
        ...productIndex,
        payload: productWithImage as unknown as Prisma.InputJsonValue,
      },
      update: {
        userId: options.userId,
        accountId: options.accountId,
        marketplace: options.marketplace,
        ...productIndex,
        payload: productWithImage as unknown as Prisma.InputJsonValue,
      },
    });

    importedCount += 1;
    await reportRowCompleted();
  });

  await prisma.auditLog.create({
    data: {
      organizationId: options.organizationId,
      userId: options.userId,
      action: "product_commodity_import",
      entityType: "product",
      metadata: {
        fileName: options.fileName,
        workspaceId: options.workspaceId,
        importedCount,
        skippedRowCount,
        imageDownloadedCount,
        imageFailedCount,
      },
    },
  });

  return {
    importedCount,
    imageDownloadedCount,
    imageFailedCount,
    skippedRowCount,
  };
}

function isCommodityWorkbookHeader(headers: string[]) {
  return [commodityFieldAliases.sku, commodityFieldAliases.name, commodityFieldAliases.imageUrl]
    .every((aliases) => headers.some((header) => aliases.includes(header)));
}

function buildSourceWorkbook(
  fileName: string,
  sku: string,
  headersBySheet: Record<string, string[]>,
  rowsBySkuBySheet: Map<string, Map<string, ProductSourceWorkbookRow[]>>,
  fallbackRecord: Record<string, string>,
): ProductSourceWorkbook {
  const rowsBySheet = Object.fromEntries(
    visibleSheets.map((sheetName) => {
      const rows = rowsBySkuBySheet.get(sku)?.get(sheetName) ?? [];
      if (sheetName === commoditySheetName && !rows.length) {
        return [sheetName, [{ rowNumber: 0, values: fallbackRecord }]];
      }
      return [sheetName, rows];
    }),
  );
  const allHeaders = Object.values(headersBySheet).flat();

  return {
    kind: "commodity-create",
    importedFileName: fileName,
    importedAt: new Date().toISOString(),
    headersBySheet,
    rowsBySheet,
    mappedFields: mappedFields.filter((field) => allHeaders.includes(field)),
    unmappedFields: allHeaders.filter((field) => field && !mappedFields.includes(field)),
    imageAssets: [],
  };
}

function buildProductFromCommodityRecord(record: Record<string, string>, sourceWorkbook: ProductSourceWorkbook): Product & { workbookDetail: Record<string, unknown> } {
  const now = new Date();
  const sku = readCommodityRecord(record, "sku");
  const name = readCommodityRecord(record, "name");
  const quote20 = parseNumber(readCommodityRecord(record, "quote20"));
  const purchasePrice = quote20 || parseNumber(readCommodityRecord(record, "purchasePrice")) || parseNumber(readCommodityRecord(record, "purchaseCost"));
  const productWeightG = convertWeightToGram(readCommodityRecord(record, "productWeight"), readCommodityRecord(record, "productWeightUnit")) || parseNumber(readCommodityRecord(record, "customsWeightG"));
  const packageWeightG = convertWeightToGram(readCommodityRecord(record, "packageWeight"), readCommodityRecord(record, "packageWeightUnit"));
  const developer = readCommodityRecord(record, "developer");
  const supplierName = readCommodityRecord(record, "supplierName");
  const supplierUrl = readCommodityRecord(record, "supplierProductUrl") || readCommodityRecord(record, "purchaseUrl");
  const note = readCommodityRecord(record, "productNote") || readCommodityRecord(record, "purchaseNote") || readCommodityRecord(record, "quoteNote");

  return {
    id: `prod-${sku}`,
    sku,
    chineseName: name,
    englishName: readCommodityRecord(record, "customsEnglishName"),
    asin: "",
    developer,
    purchasePrice,
    status: commodityStatusMap[readCommodityRecord(record, "status")] ?? "pending",
    supplierName,
    supplierUrl,
    specs: [readCommodityRecord(record, "material"), readCommodityRecord(record, "model"), readCommodityRecord(record, "use")].filter(Boolean).join(";"),
    purchaseLeadTime: readCommodityRecord(record, "purchaseLeadTime"),
    createdAt: readCommodityRecord(record, "developmentDate") || formatDateTime(now),
    keywords: "",
    note,
    cancelReason: "",
    hsCode: readCommodityRecord(record, "hsCode"),
    images: splitList(readCommodityRecord(record, "imageUrl")),
    competitorAsins: [],
    productWeightG,
    packageWeightG,
    productSizeCm: {
      length: parseNumber(readCommodityRecord(record, "productLengthCm")),
      width: parseNumber(readCommodityRecord(record, "productWidthCm")),
      height: parseNumber(readCommodityRecord(record, "productHeightCm")),
    },
    packageSizeCm: {
      length: parseNumber(readCommodityRecord(record, "packageLengthCm")),
      width: parseNumber(readCommodityRecord(record, "packageWidthCm")),
      height: parseNumber(readCommodityRecord(record, "packageHeightCm")),
    },
    selectionOwner: developer,
    opsAssignees: splitList(readCommodityRecord(record, "viewer")),
    opsAssignee: readCommodityRecord(record, "viewer"),
    viewableBy: splitList(readCommodityRecord(record, "viewer")),
    workflowStage: "selection_pending",
    workflowStartedAt: now.toISOString(),
    workflowUpdatedAt: now.toISOString(),
    workflowDueAt: createWorkflowDueAt(now),
    workflowHistory: [
      buildWorkflowEvent({
        stage: "selection_pending",
        actorName: developer,
        assigneeName: developer,
        note: "从商品创建任务导入商品。",
        createdAt: now,
      }),
    ],
    workbookDetail: {
      suppliers: [{
        productUrl: supplierUrl,
        factoryName: supplierName,
        configuration: readCommodityRecord(record, "model"),
        moq: readCommodityRecord(record, "minPurchaseQuantity"),
        leadTime: readCommodityRecord(record, "purchaseLeadTime"),
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: quote20 || purchasePrice,
        cost300: 0,
        taxPoint: readCommodityRecord(record, "taxRate"),
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      }],
      remark: note,
      remarkImages: [],
    },
    sourceWorkbook,
  };
}

async function hydrateProductMainImage(product: Product, scope: CommodityImportScope): Promise<Product> {
  const sourceUrl = product.images.find((image) => /^https?:\/\//iu.test(image.trim()));
  const imageAssets = product.sourceWorkbook?.imageAssets ?? [];

  if (!sourceUrl) {
    return {
      ...product,
      sourceWorkbook: {
        ...product.sourceWorkbook!,
        imageAssets: [...imageAssets, { sourceUrl: "", status: "skipped", error: "没有图片链接" }],
      },
    };
  }

  const asset = await downloadImageAsset(sourceUrl, product.sku, scope);

  if (asset.status !== "downloaded" || !asset.assetUrl) {
    return {
      ...product,
      sourceWorkbook: {
        ...product.sourceWorkbook!,
        imageAssets: [...imageAssets, asset],
      },
    };
  }

  return {
    ...product,
    images: [asset.assetUrl, ...product.images.filter((image) => image !== sourceUrl)].slice(0, 10),
    sourceWorkbook: {
      ...product.sourceWorkbook!,
      imageAssets: [...imageAssets, asset],
    },
  };
}

async function downloadImageAsset(sourceUrl: string, sku: string, scope: CommodityImportScope): Promise<ProductSourceImageAsset> {
  try {
    const url = new URL(sourceUrl);
    const response = await fetch(url, {
      headers: { "User-Agent": "AmazonBulkAdWorkbench/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`远程图片下载失败：${response.status}`);
    }

    const responseContentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const contentLength = Number(response.headers.get("content-length"));

    if (Number.isFinite(contentLength) && contentLength > maxAssetSize) {
      throw new Error("图片超过 50MB。");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxAssetSize) {
      throw new Error("图片超过 50MB。");
    }

    const contentType = supportedImageTypes.has(responseContentType)
      ? responseContentType
      : inferImageContentType(url, buffer);

    if (!contentType) {
      throw new Error("远程文件不是支持的图片格式。");
    }

    const key = createImageAssetKey(sku, url, contentType);
    const storedObject = await getStorageDriver().putBuffer({ key, buffer, contentType });

    await prisma.fileObject.create({
      data: {
        organizationId: scope.organizationId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        originalName: path.basename(url.pathname) || `${sku}${contentTypeExtensions[contentType] ?? ".jpg"}`,
        mimeType: contentType,
        size: storedObject.size,
        storageKey: storedObject.key,
        storageType: getStorageType(),
        status: "done",
      },
    });

    return {
      sourceUrl,
      assetKey: storedObject.key,
      assetUrl: createAssetUrl(storedObject.key),
      status: "downloaded",
      downloadedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      sourceUrl,
      status: "failed",
      error: error instanceof Error ? error.message : "图片下载失败",
    };
  }
}

function createImageAssetKey(sku: string, url: URL, contentType: string) {
  const extensionFromUrl = path.extname(url.pathname).toLowerCase();
  const extension = extensionFromUrl && extensionFromUrl.length <= 6 ? extensionFromUrl : contentTypeExtensions[contentType] ?? ".jpg";
  const normalizedSku = sku.replace(/[^a-z0-9_-]/giu, "-").slice(0, 80) || "product";
  return `assets/products/${new Date().toISOString().slice(0, 10)}/${normalizedSku}-${randomUUID()}${extension}`;
}

function inferImageContentType(url: URL, buffer: Buffer) {
  const extension = path.extname(url.pathname).toLowerCase();

  if (extension === ".avif") return "image/avif";
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(4, 12).toString("ascii") === "ftypavif") return "image/avif";

  return "";
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const pending = new Set<Promise<void>>();

  for (const item of items) {
    const task = worker(item);
    const trackedTask = task.finally(() => {
      pending.delete(trackedTask);
    });
    pending.add(trackedTask);

    if (pending.size >= concurrency) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);
}

function normalizeHeaders(headers: string[]) {
  return headers.map(cleanText).filter(Boolean);
}

function rowToRecord(headers: string[], row: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]));
}

function readCommodityRecord(record: Record<string, string>, field: keyof typeof commodityFieldAliases) {
  return commodityFieldAliases[field].map((alias) => cleanText(record[alias])).find(Boolean) ?? "";
}

function findColumnIndexByAliases(row: string[], aliases: string[]) {
  const index = row.findIndex((cell) => aliases.includes(cleanText(cell)));
  return index >= 0 ? index : -1;
}

function splitList(value: string) {
  return value.split(/[,，;\s]+/u).map((item) => item.trim()).filter(Boolean);
}

function convertWeightToGram(value: string, unit: string) {
  const weight = parseNumber(value);
  if (!weight) return 0;
  const normalizedUnit = unit.trim().toLowerCase();
  if (normalizedUnit === "kg") return Math.round(weight * 1000);
  if (normalizedUnit === "lb") return Math.round(weight * 453.59237);
  if (normalizedUnit === "oz") return Math.round(weight * 28.349523125);
  return Math.round(weight);
}

function parseNumber(value: unknown) {
  const text = cleanText(value).replace(/[$,%￥¥]/g, "").replace(/,/g, "");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
