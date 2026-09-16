import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createProductListItem, createProductListWhere, splitMultiValue } from "@/lib/products/list-query";
import type { Product } from "@/lib/products/types";

export type ProductExportJobPayload = {
  search?: string;
  asin?: string;
  status?: string | null;
  supplierName?: string;
  opsAssignees?: string[];
  selectionOwners?: string[];
  designerAssignees?: string[];
  mySkuOwner?: string;
  createdByMe?: boolean;
  minPrice?: number;
  maxPrice?: number;
};

const productExportHeaders = [
  "SKU",
  "中文名",
  "英文名",
  "状态",
  "当前负责人",
  "更新时间",
  "ASIN",
  "采购价格",
  "供应商名称",
  "选品负责人",
  "运营负责人",
  "美工负责人",
  "流程截止",
];

export function buildProductExportPayload(url: URL) {
  const status = url.searchParams.get("status");

  return {
    search: url.searchParams.get("search")?.trim() || undefined,
    asin: url.searchParams.get("asin")?.trim() || undefined,
    status: status === "all" ? null : status?.trim() || undefined,
    supplierName: url.searchParams.get("supplierName")?.trim() || undefined,
    opsAssignees: splitMultiValue(url.searchParams.get("opsAssignees")),
    selectionOwners: splitMultiValue(url.searchParams.get("selectionOwners")),
    designerAssignees: splitMultiValue(url.searchParams.get("designerAssignees")),
    mySkuOwner: url.searchParams.get("mySkuOwner")?.trim() || undefined,
    createdByMe: url.searchParams.get("createdByMe") === "true",
    minPrice: parseOptionalNumber(url.searchParams.get("minPrice")),
    maxPrice: parseOptionalNumber(url.searchParams.get("maxPrice")),
  } satisfies ProductExportJobPayload;
}

export function normalizeProductExportPayload(value: unknown): ProductExportJobPayload {
  if (!value || typeof value !== "object") {
    return {};
  }

  const payload = value as Partial<ProductExportJobPayload>;

  return {
    search: typeof payload.search === "string" ? payload.search.trim() || undefined : undefined,
    asin: typeof payload.asin === "string" ? payload.asin.trim() || undefined : undefined,
    status: typeof payload.status === "string" ? payload.status.trim() || undefined : null,
    supplierName: typeof payload.supplierName === "string" ? payload.supplierName.trim() || undefined : undefined,
    opsAssignees: Array.isArray(payload.opsAssignees) ? payload.opsAssignees.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    selectionOwners: Array.isArray(payload.selectionOwners) ? payload.selectionOwners.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    designerAssignees: Array.isArray(payload.designerAssignees) ? payload.designerAssignees.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    mySkuOwner: typeof payload.mySkuOwner === "string" ? payload.mySkuOwner.trim() || undefined : undefined,
    createdByMe: payload.createdByMe === true,
    minPrice: normalizeNumber(payload.minPrice),
    maxPrice: normalizeNumber(payload.maxPrice),
  };
}

export function createProductExportFileName(now = new Date()) {
  return `products-${now.toISOString().slice(0, 10)}.xlsx`;
}

export function createProductExportStorageKey(now = new Date()) {
  return `exports/products/${now.toISOString().slice(0, 10)}/${randomUUID()}.xlsx`;
}

type ExportProduct = Product & {
  workbookDetail?: {
    title?: string;
    pricingRows?: Array<{
      name?: string;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      actualWeightKg?: number;
      suggestedPrice?: number;
      purchaseCost?: number;
      oceanFreightUnitPrice?: number;
      fbaFee?: number;
      exchangeRate?: number;
    }>;
    competitors?: Array<Record<string, unknown>>;
    suppliers?: Array<Record<string, unknown>>;
    improvement?: Record<string, unknown>;
    remark?: string;
    keywords?: Array<Record<string, unknown>>;
  };
};

const pricingHeaders = [
  "品名", "长cm", "宽cm", "高cm", "实际重Kg", "材积重Kg", "体积重/磅", "实重/磅",
  "配送费取值（磅）", "建议售价", "采购成本", "FBA配送费", " 3.5% 的燃油和物流相关附加费（USD)",
  "海运头程", "佣金", "月仓储费", "汇率", "保本价", "海运毛利润", "海运毛利率", "3磅+配送费",
];

const competitorHeaders = [
  "多套装组合", "ASIN", "近30天销量&上架时间", "变体数量", "变体类型", "热销变体图片",
  "热销变体规格", "热销变体价格($)", "近3个月价格变动备注", "评论数", "评分",
  "差评点1", "差评点2", "差评点3", "店铺分析", "竞品包装\n尺寸",
];

const supplierHeaders = [
  "供应商产品链接", "厂家名称", "配置", "起订量", "交期", "相关认证", "专利国家", "产品包装方式",
  "采购成本（100套）\n（包含说明书，包装）", "采购成本（300）\n（包含说明书，包装）", "是否包国内物流费",
  "发票类型/税点", "单个税额", "Total price", "开票命名", "开票规格-单位\n（套/个/件/卷/条...)", "开票地区",
];

const improvementHeaders = [
  "产品改进点", "使用人群", "主要适用场景", "产品痛点1", "产品痛点2", "产品痛点3",
  "材质改进", "尺寸改进", "功能改进", "外观（款式）", "配件（搭配）", "包装改进",
  "说明书", "文案/主/附图片建议", "旺季月份", "头部旺季平均销量", "头部淡季平均销量",
  "目标销量", "侵权（专利/产权）", "认证",
];

const keywordHeaders = ["关键词", "CPC", "月搜索量", "ABA周排名"];

const columnWidths = [
  18, 12, 12, 10, 12, 12, 12, 12, 14, 12, 12, 13, 15, 12, 12, 12, 10, 12, 12, 12, 13,
];

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function styleRange(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  options: { fill?: string; bold?: boolean; fontColor?: string; rowHeight?: number } = {},
) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (options.rowHeight) row.height = options.rowHeight;
    for (let columnNumber = startColumn; columnNumber <= endColumn; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };
      if (options.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
      if (options.bold || options.fontColor) {
        cell.font = {
          name: "等线",
          size: 10,
          bold: options.bold,
          color: options.fontColor ? { argb: options.fontColor } : undefined,
        };
      }
    }
  }
}

function sanitizeSheetName(value: string, index: number) {
  const base = value.replace(/[\\/*?:[\]]/g, "_").trim() || `SKU-${index + 1}`;
  return base.slice(0, 31);
}

function getDetail(product: ExportProduct) {
  return product.workbookDetail ?? {};
}

function buildPricingRows(product: ExportProduct) {
  const detail = getDetail(product);
  if (detail.pricingRows?.length) return detail.pricingRows;

  return [{
    name: product.chineseName || product.englishName || product.sku,
    lengthCm: product.packageSizeCm?.length ?? 0,
    widthCm: product.packageSizeCm?.width ?? 0,
    heightCm: product.packageSizeCm?.height ?? 0,
    actualWeightKg: numberValue(product.packageWeightG) / 1000,
    suggestedPrice: 0,
    purchaseCost: product.purchasePrice,
    oceanFreightUnitPrice: 12,
    fbaFee: 0,
    exchangeRate: 6.8,
  }];
}

function isPackagedSku(product: ExportProduct) {
  return product.sku === "0000";
}

function normalizeExportProductName(value: unknown) {
  return stringValue(value)
    .replace(/^SKU:\s*[^|]+\|\s*/i, "")
    .replace(/\s*\+\s*(?:2|4)\s*pcs\s*$/i, "")
    .trim();
}

function getExportProductName(product: ExportProduct) {
  const detailTitle = normalizeExportProductName(getDetail(product).title);
  if (detailTitle) {
    return detailTitle;
  }

  return normalizeExportProductName(product.chineseName)
    || normalizeExportProductName(product.englishName)
    || product.sku;
}

function getExportPricingRowName(product: ExportProduct, source: Record<string, unknown>, index: number) {
  if (!isPackagedSku(product) || index > 1) {
    return stringValue(source.name || product.chineseName || product.englishName || product.sku);
  }

  return `${getExportProductName(product)}+${index === 0 ? 2 : 4}pcs`;
}

function buildCompetitorRows(product: ExportProduct) {
  const detail = getDetail(product);
  if (detail.competitors?.length) return detail.competitors;
  return product.competitorAsins.map((asin) => ({ type: "参考竞品", asin }));
}

function buildSupplierRows(product: ExportProduct) {
  const detail = getDetail(product);
  if (detail.suppliers?.length) return detail.suppliers;
  return [{
    productUrl: product.supplierUrl,
    factoryName: product.supplierName,
    leadTime: product.purchaseLeadTime,
    cost100: product.purchasePrice,
  }];
}

function buildImprovement(product: ExportProduct): Record<string, unknown> {
  const detail = getDetail(product);
  const improvement: Record<string, unknown> = detail.improvement ?? {};
  return {
    ...improvement,
    certification: improvement.certification ?? "",
  };
}

function buildKeywordRows(product: ExportProduct) {
  const detail = getDetail(product);
  if (detail.keywords?.length) return detail.keywords;
  return product.keywords
    .split(/[,\n，]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => ({ keyword }));
}

function writePricingSection(worksheet: ExcelJS.Worksheet, product: ExportProduct, startRow: number, rows: Array<Record<string, unknown>>) {
  worksheet.getRow(startRow).values = pricingHeaders;
  styleRange(worksheet, startRow, 1, startRow, 21, { fill: "FF92D050", bold: true, rowHeight: 25.5 });
  worksheet.getCell(startRow, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
  worksheet.getCell(startRow, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
  worksheet.getCell(startRow, 9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
  worksheet.getCell(startRow, 13).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };

  rows.forEach((source, index) => {
    const rowNumber = startRow + 1 + index;
    const name = getExportPricingRowName(product, source, index);
    const values = [
      name,
      numberValue(source.lengthCm),
      numberValue(source.widthCm),
      numberValue(source.heightCm),
      numberValue(source.actualWeightKg),
      null,
      null,
      null,
      null,
      numberValue(source.suggestedPrice),
      numberValue(source.purchaseCost, product.purchasePrice),
      numberValue(source.fbaFee),
      null,
      null,
      null,
      null,
      numberValue(source.exchangeRate, 6.8),
      null,
      null,
      null,
      null,
    ];
    worksheet.getRow(rowNumber).values = values;
    worksheet.getCell(rowNumber, 6).value = { formula: `IF($A${rowNumber}="","",B${rowNumber}*C${rowNumber}*D${rowNumber}/6000)` };
    worksheet.getCell(rowNumber, 7).value = { formula: `IF($A${rowNumber}="","",(B${rowNumber}/2.54*C${rowNumber}/2.54*D${rowNumber}/2.54)/139)` };
    worksheet.getCell(rowNumber, 8).value = { formula: `IF($A${rowNumber}="","",E${rowNumber}*2.2)` };
    worksheet.getCell(rowNumber, 9).value = { formula: `IF($A${rowNumber}="","",MAX(G${rowNumber},H${rowNumber}))` };
    worksheet.getCell(rowNumber, 13).value = { formula: `IF($A${rowNumber}="","",L${rowNumber}*0.035)` };
    worksheet.getCell(rowNumber, 14).value = { formula: `IF($A${rowNumber}="","",MAX(E${rowNumber},F${rowNumber})*12)` };
    worksheet.getCell(rowNumber, 15).value = { formula: `IF($A${rowNumber}="","",J${rowNumber}*0.15)` };
    worksheet.getCell(rowNumber, 16).value = { formula: `IF($A${rowNumber}="","",(B${rowNumber}/2.54)*(C${rowNumber}/2.54)*(D${rowNumber}/2.54)*0.000578*0.87)` };
    worksheet.getCell(rowNumber, 18).value = { formula: `IF($A${rowNumber}="","",(K${rowNumber}+N${rowNumber})/Q${rowNumber}+M${rowNumber}+O${rowNumber}+L${rowNumber}+P${rowNumber})` };
    worksheet.getCell(rowNumber, 19).value = { formula: `IF($A${rowNumber}="","",J${rowNumber}-R${rowNumber})` };
    worksheet.getCell(rowNumber, 20).value = { formula: `IF($A${rowNumber}="","",IFERROR(S${rowNumber}/J${rowNumber},0))` };
    worksheet.getCell(rowNumber, 21).value = { formula: `IF($A${rowNumber}="","",IF(I${rowNumber}>3,(I${rowNumber}-3)*16/4*0.08+6.97,0))` };
  });

  styleRange(worksheet, startRow + 1, 1, startRow + rows.length, 21, { rowHeight: 30 });
  worksheet.getColumn(20).numFmt = "0.00%";
}

function writeProductExportSheet(workbook: ExcelJS.Workbook, product: ExportProduct, index: number) {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(product.sku, index));
  columnWidths.forEach((width, columnIndex) => {
    worksheet.getColumn(columnIndex + 1).width = width;
  });

  const pricingRows = buildPricingRows(product);
  const pricingCapacity = Math.max(9, pricingRows.length);
  writePricingSection(worksheet, product, 1, pricingRows);

  const competitorHeaderRow = pricingCapacity + 2;
  worksheet.getRow(competitorHeaderRow).values = competitorHeaders;
  styleRange(worksheet, competitorHeaderRow, 1, competitorHeaderRow, 16, { fill: "FF92D050", bold: true, rowHeight: 48 });
  const competitorRows = buildCompetitorRows(product);
  const competitorCapacity = Math.max(6, competitorRows.length);
  competitorRows.forEach((source, index) => {
    const rowNumber = competitorHeaderRow + 1 + index;
    worksheet.getRow(rowNumber).values = [
      stringValue(source.type || "参考竞品"),
      stringValue(source.asin),
      stringValue(source.sales30Days),
      stringValue(source.variantCount),
      stringValue(source.variantType),
      "",
      stringValue(source.hotVariantSpec),
      [source.hotVariantPrice, source.fbaFee].filter(Boolean).join("\n"),
      stringValue(source.priceChangeNote),
      stringValue(source.reviewCount),
      stringValue(source.rating),
      stringValue(source.negativePoint1),
      stringValue(source.negativePoint2),
      stringValue(source.negativePoint3),
      stringValue(source.note),
      stringValue(source.packageSize),
    ];
  });
  styleRange(worksheet, competitorHeaderRow + 1, 1, competitorHeaderRow + competitorCapacity, 16, { rowHeight: 100 });

  const supplierHeaderRow = competitorHeaderRow + competitorCapacity + 4;
  worksheet.getRow(supplierHeaderRow).values = supplierHeaders;
  styleRange(worksheet, supplierHeaderRow, 1, supplierHeaderRow, 17, { fill: "FF92D050", bold: true, rowHeight: 48 });
  const supplierRows = buildSupplierRows(product);
  const supplierCapacity = Math.max(5, supplierRows.length);
  supplierRows.forEach((source, index) => {
    const rowNumber = supplierHeaderRow + 1 + index;
    worksheet.getRow(rowNumber).values = [
      stringValue(source.productUrl),
      stringValue(source.factoryName),
      stringValue(source.configuration),
      stringValue(source.moq),
      stringValue(source.leadTime),
      stringValue(source.certifications),
      stringValue(source.patentCountry),
      stringValue(source.packagingMethod),
      numberValue(source.cost100),
      numberValue(source.cost300),
      stringValue(source.domesticFreightIncluded),
      stringValue(source.taxPoint),
      stringValue(source.taxAmount),
      stringValue(source.totalPrice),
      stringValue(source.invoiceName),
      stringValue(source.invoiceSpecUnit),
      stringValue(source.invoiceRegion),
    ];
  });
  styleRange(worksheet, supplierHeaderRow + 1, 1, supplierHeaderRow + supplierCapacity, 17, { rowHeight: 84.75 });

  const improvementHeaderRow = supplierHeaderRow + supplierCapacity + 2;
  worksheet.getRow(improvementHeaderRow).values = improvementHeaders;
  styleRange(worksheet, improvementHeaderRow, 1, improvementHeaderRow, 20, { fill: "FF8EAADB", bold: true, rowHeight: 48 });
  const improvement = buildImprovement(product);
  worksheet.getRow(improvementHeaderRow + 1).values = [
    "产品改进点",
    stringValue(improvement.audience),
    stringValue(improvement.scenario),
    stringValue(improvement.painPoint1),
    stringValue(improvement.painPoint2),
    stringValue(improvement.painPoint3),
    stringValue(improvement.material),
    stringValue(improvement.size),
    stringValue(improvement.functionImprovement),
    stringValue(improvement.appearance),
    stringValue(improvement.accessories),
    stringValue(improvement.packaging),
    stringValue(improvement.manual),
    stringValue(improvement.imageCopySuggestion),
    Array.isArray(improvement.peakSeasonWeights) ? improvement.peakSeasonWeights.join(",") : stringValue(improvement.peakSeasonWeights),
    stringValue(improvement.peakSales),
    stringValue(improvement.offSeasonSales),
    stringValue(improvement.targetSales),
    stringValue(improvement.infringement),
    stringValue(improvement.certification),
  ];
  worksheet.getRow(improvementHeaderRow + 2).values = ["备注", "", "", "", "", "", "", "", "", stringValue(getDetail(product).remark || product.note)];
  styleRange(worksheet, improvementHeaderRow + 1, 1, improvementHeaderRow + 2, 20, { rowHeight: 57 });

  const keywordHeaderRow = improvementHeaderRow + 5;
  worksheet.getRow(keywordHeaderRow).values = keywordHeaders;
  styleRange(worksheet, keywordHeaderRow, 1, keywordHeaderRow, 4, { fill: "FF92D050", bold: true, rowHeight: 30 });
  const keywordRows = buildKeywordRows(product);
  keywordRows.forEach((source, index) => {
    const rowNumber = keywordHeaderRow + 1 + index;
    worksheet.getRow(rowNumber).values = [
      stringValue(source.keyword),
      numberValue(source.cpc),
      numberValue(source.monthlySearches),
      numberValue(source.abaRank),
    ];
  });
  styleRange(worksheet, keywordHeaderRow + 1, 1, keywordHeaderRow + Math.max(1, keywordRows.length), 4, { rowHeight: 22 });
  worksheet.getColumn(1).width = 24;
  worksheet.getColumn(2).width = 14;
  worksheet.getColumn(3).width = 14;
  worksheet.getColumn(4).width = 12;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  return worksheet;
}

export async function buildProductExportWorkbook(products: Product[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Product Center";
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  products.forEach((product, index) => {
    writeProductExportSheet(workbook, product as ExportProduct, index);
  });

  if (!products.length) {
    writeProductExportSheet(workbook, {
      id: "empty",
      sku: "empty",
      chineseName: "无匹配商品",
      englishName: "",
      image: "",
      asin: "",
      developer: "",
      purchasePrice: 0,
      status: "pending",
      supplierName: "",
      supplierUrl: "",
      specs: "",
      purchaseLeadTime: "",
      createdAt: new Date().toISOString(),
      keywords: "",
      note: "",
      cancelReason: "",
      hsCode: "",
      images: [],
      competitorAsins: [],
      productWeightG: 0,
      packageWeightG: 0,
      productSizeCm: { length: 0, width: 0, height: 0 },
      packageSizeCm: { length: 0, width: 0, height: 0 },
    }, 0);
  }

  return workbook.xlsx.writeBuffer();
}

export function buildProductExportCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  const lines = [
    productExportHeaders.map(csvEscape).join(","),
    ...rows.map((row) => productExportHeaders.map((header) => csvEscape(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

export function buildProductExportRows(records: Array<Parameters<typeof createProductListItem>[0]>) {
  return records.map((record) => {
    const listItem = createProductListItem(record);

    return {
      SKU: listItem.sku,
      中文名: listItem.chineseName,
      英文名: listItem.englishName,
      状态: listItem.status,
      当前负责人: listItem.currentOwner,
      更新时间: listItem.updatedAt,
      ASIN: record.asin,
      采购价格: record.purchasePrice,
      供应商名称: record.supplierName,
      选品负责人: record.selectionOwner,
      运营负责人: record.opsAssignee,
      美工负责人: record.designerAssignee,
      流程截止: record.workflowDueAt?.toISOString() ?? "",
    };
  });
}

export function buildProductExportWhere(input: {
  user: { organizationId: string; id?: string };
  workspaceId: string;
  payload: ProductExportJobPayload;
}) {
  return createProductListWhere({
    user: input.user,
    workspaceId: input.workspaceId,
    search: input.payload.search,
    asin: input.payload.asin,
    status: input.payload.status ?? undefined,
    supplierName: input.payload.supplierName,
    opsAssignees: input.payload.opsAssignees ?? [],
    selectionOwners: input.payload.selectionOwners ?? [],
    designerAssignees: input.payload.designerAssignees ?? [],
    mySkuOwner: input.payload.mySkuOwner,
    userId: input.payload.createdByMe ? input.user.id : undefined,
    minPrice: input.payload.minPrice,
    maxPrice: input.payload.maxPrice,
  });
}

function parseOptionalNumber(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function csvEscape(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
