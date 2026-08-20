import type { Product, ProductSourceWorkbook, ProductSourceWorkbookRow, ProductStatus } from "@/lib/products/types";
import { normalizeOperationsProgress } from "@/lib/products/operations-progress";
import { buildWorkflowEvent, createWorkflowDueAt, getProductWorkflowStage, normalizeAssigneeList } from "@/lib/products/workflow";
import { createEmptyImprovementRow } from "./product-workbook-detail-sections";
import {
  emptySize,
  createDefaultPeakSeasonWeights,
  normalizePeakSeasonWeights,
  type ProductEditorDraft,
  type TrialCompetitorRow,
  type TrialImprovement,
  type TrialKeywordRow,
  type TrialPriceRow,
  type TrialProductDraft,
  type TrialSupplierRow,
} from "./product-workbench-model";
import { formatDateTime, nextSku } from "./product-workbench-utils";

const commoditySheetName = "商品";
const countryFreightSheetName = "按国家维护头程费用";
const supplierQuoteSheetName = "更多供应商报价";

const commodityHeaders = [
  "SKU",
  "品名",
  "商品编码",
  "图片链接",
  "分类",
  "识别码",
  "商品品牌",
  "材质",
  "型号",
  "用途",
  "单位",
  "spu",
  "变种属性(中)",
  "变种属性(英)",
  "款名",
  "组合明细",
  "关联辅料数",
  "包含单品（品名）",
  "包含单品（SKU）",
  "Listing配对状态",
  "状态",
  "1688配对",
  "HS Code配对状态",
  "商品备注",
  "开发员",
  "采购员",
  "查看人",
  "开启加工过程",
  "加工费(¥)",
  "商品重量",
  "商品重量单位",
  "开发时间",
  "商品标签",
  "商品规格长(cm)",
  "商品规格宽(cm)",
  "商品规格高(cm)",
  "采购成本(￥)",
  "采购备注",
  "采购交期",
  "开启质检流程",
  "最低采购量",
  "箱规长(cm)",
  "箱规宽(cm)",
  "箱规高(cm)",
  "单箱重量(kg)",
  "单箱数量(pcs)",
  "中文报关名",
  "英文报关名",
  "报关单价",
  "报关单价币种",
  "报关重量(g)",
  "危险品运输",
  "海关编码",
  "创建时间",
  "来源",
  "首选供应商",
  "供应商名称",
  "币种",
  "商品包装规格长(cm)",
  "商品包装规格宽(cm)",
  "商品包装规格高(cm)",
  "商品包装重量",
  "商品包装重量单位",
  "是否含税",
  "税率",
  "更新时间",
  "采购单价",
  "报价（20套）",
  "含税价",
  "采购链接",
  "供应商产品链接",
  "报价备注",
  "最小采购量",
  "中文材质",
  "英文材质",
  "中文用途",
  "英文用途",
  "报关型号",
  "报关单位",
  "品牌类型",
  "出口享惠情况",
  "申报要素",
  "原产地(地区)",
  "境内货源地",
  "征免",
  "生产销售企业名称",
  "生产销售企业代码",
];

const supplierQuoteHeaders = ["SKU", "首选供应商", "供应商名称", "币种", "是否含税", "税率", "采购单价", "含税价", "采购链接", "报价备注", "最小采购量"];
const countryFreightHeaders = ["SKU", "国家名称", "头程费用（CNY）", "清关HSCODE", "清关单价", "清关单价币种", "清关税率", "产品链接", "备注"];

const commodityVisibleSheets = [commoditySheetName, supplierQuoteSheetName, countryFreightSheetName];
const commodityMappedFields = [
  "*SKU",
  "*品名",
  "状态",
  "材质",
  "型号",
  "用途",
  "开发员",
  "查看人",
  "图片链接",
  "采购成本(CNY)",
  "采购备注",
  "采购交期",
  "商品备注",
  "中文报关名",
  "英文报关名",
  "报关重量(g)",
  "海关编码",
  "商品包装规格长(cm)",
  "商品包装规格宽(cm)",
  "商品包装规格高(cm)",
  "商品包装重量",
  "商品包装重量单位",
  "商品尺寸长(cm)",
  "商品尺寸宽(cm)",
  "商品尺寸高(cm)",
  "商品重量",
  "商品重量单位",
  "首选供应商名称",
  "最小采购量",
  "采购单价",
  "报价（20套）",
  "采购链接",
  "供应商产品链接",
  "开发时间",
];

const commodityStatusMap: Record<string, ProductStatus> = {
  开发中: "developing",
  待售: "listing_confirming",
  在售: "listed",
  清仓: "developing",
  停售: "delisted",
};

const productStatusCommodityLabels: Partial<Record<ProductStatus, string>> = {
  pending: "开发中",
  developing: "开发中",
  ops_review: "开发中",
  design_in_progress: "开发中",
  listing_confirming: "待售",
  listed: "在售",
  canceled: "停售",
  delisted: "停售",
  patent_risk: "停售",
};

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
  customsChineseName: ["中文报关名"],
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
  preferredSupplierName: ["首选供应商名称", "首选供应商", "供应商名称"],
  currency: ["货币单位", "币种"],
  taxIncluded: ["是否含税"],
  taxRate: ["税率"],
  purchasePrice: ["采购单价"],
  taxIncludedPrice: ["含税价"],
  purchaseUrl: ["采购链接"],
  quote20: ["报价（20套）"],
  supplierProductUrl: ["供应商产品链接"],
  quoteNote: ["报价备注"],
  developmentDate: ["开发时间", "创建时间"],
} satisfies Record<string, string[]>;

export async function parseProductWorkbookFile(file: File, products: Product[]): Promise<Product> {
  const parsedProducts = await parseProductWorkbookProducts(file, products);
  if (!parsedProducts[0]) {
    throw new Error("Excel 文件没有可导入的数据行。");
  }
  return parsedProducts[0];
}

export async function parseProductWorkbookProducts(file: File, products: Product[]): Promise<Product[]> {
  const buffer = await file.arrayBuffer();
  const [XLSXModule, JSZipModule] = await Promise.all([import("xlsx"), import("jszip")]);
  const XLSX = XLSXModule;
  const JSZip = JSZipModule.default;
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("Excel 文件没有可读取的工作表。");
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  if (isCommodityCreateWorkbook(workbook, XLSX)) {
    return parseCommodityCreateWorkbook(workbook, XLSX, file.name, products);
  }

  const detail = createTrialProductDraft();
  const pricingHeaderIndex = 0;
  const competitorHeaderIndex = findOptionalRowIndex(rows, "ASIN");
  const supplierHeaderIndex = findOptionalRowIndex(rows, "供应商产品链接");
  const improvementHeaderIndex = findOptionalRowIndex(rows, "使用人群");
  const keywordHeaderIndex = findOptionalRowIndex(rows, "关键词");
  const remarkHeaderIndex = findOptionalRowIndex(rows, "备注");
  const pricingEndIndex = findNextRowIndex(rows.length, pricingHeaderIndex, [competitorHeaderIndex, supplierHeaderIndex, improvementHeaderIndex, keywordHeaderIndex, remarkHeaderIndex]);
  const competitorEndIndex = findNextRowIndex(rows.length, competitorHeaderIndex, [supplierHeaderIndex, improvementHeaderIndex, keywordHeaderIndex, remarkHeaderIndex]);
  const supplierEndIndex = findNextRowIndex(rows.length, supplierHeaderIndex, [improvementHeaderIndex, keywordHeaderIndex, remarkHeaderIndex]);
  const improvementEndIndex = findNextRowIndex(rows.length, improvementHeaderIndex, [keywordHeaderIndex, remarkHeaderIndex]);
  const keywordEndIndex = findNextRowIndex(rows.length, keywordHeaderIndex, [remarkHeaderIndex]);

  detail.title = textAt(rows, pricingHeaderIndex + 1, 0) || file.name.replace(/\.(xlsx|xls)$/i, "");
  detail.pricingRows = parsePricingRows(rows, pricingHeaderIndex, pricingEndIndex);
  detail.competitors = parseCompetitorRows(rows, competitorHeaderIndex, competitorEndIndex);
  detail.suppliers = supplierHeaderIndex >= 0 ? parseSupplierRows(rows, supplierHeaderIndex, supplierEndIndex) : [];
  detail.improvement = parseImprovementRows(rows, improvementHeaderIndex, improvementEndIndex);
  detail.keywords = parseKeywordRows(rows, keywordHeaderIndex, keywordEndIndex);
  detail.remark = textAt(rows, findRowIndex(rows, "备注"), 0) === "备注" ? "" : detail.remark;
  detail.remarkImages = [];

  const images = await extractWorkbookImages(buffer, JSZip);
  const hotVariantCol = findColumnIndex(rows[competitorHeaderIndex] ?? [], "热销变体图片");
  const competitorStartRow = competitorHeaderIndex + 1;
  const competitorEndRow = supplierHeaderIndex > competitorStartRow ? supplierHeaderIndex : competitorStartRow + detail.competitors.length;

  images.forEach((image) => {
    if (image.col === hotVariantCol && image.row >= competitorStartRow && image.row < competitorEndRow) {
      const competitorIndex = Math.min(Math.max(image.row - competitorStartRow, 0), detail.competitors.length - 1);
      if (detail.competitors[competitorIndex]) {
        detail.competitors[competitorIndex].hotVariantImage = image.dataUrl;
        return;
      }
    }

    detail.remarkImages.push(image.dataUrl);
  });

  const sku = nextSku(products);
  const now = new Date();
  const developer = extractDeveloperName(file.name);

  return [{
    sku,
    id: `prod-${sku}`,
    chineseName: detail.title,
    englishName: "",
    asin: detail.competitors[0]?.asin ?? "",
    developer,
    purchasePrice: detail.pricingRows[0]?.purchaseCost ?? 0,
    status: "pending",
    supplierName: detail.suppliers[0]?.factoryName ?? "",
    supplierUrl: detail.suppliers[0]?.productUrl ?? "",
    specs: detail.pricingRows.map((row) => row.name).filter(Boolean).join(";"),
    purchaseLeadTime: detail.suppliers[0]?.leadTime ?? "",
    createdAt: formatDateTime(new Date()),
    keywords: detail.keywords.map((row) => row.keyword).filter(Boolean).join(","),
    note: detail.remark,
    cancelReason: "",
    hsCode: "",
    images: detail.remarkImages.slice(0, 1),
    competitorAsins: detail.competitors.map((competitor) => competitor.asin.trim()).filter(Boolean),
    productWeightG: Math.round((detail.pricingRows[0]?.actualWeightKg ?? 0) * 1000),
    packageWeightG: Math.round((detail.pricingRows[0]?.actualWeightKg ?? 0) * 1000),
    productSizeCm: {
      length: detail.pricingRows[0]?.lengthCm ?? 0,
      width: detail.pricingRows[0]?.widthCm ?? 0,
      height: detail.pricingRows[0]?.heightCm ?? 0,
    },
    packageSizeCm: {
      length: detail.pricingRows[0]?.lengthCm ?? 0,
      width: detail.pricingRows[0]?.widthCm ?? 0,
      height: detail.pricingRows[0]?.heightCm ?? 0,
    },
    selectionOwner: developer,
    workflowStage: "selection_pending",
    workflowStartedAt: now.toISOString(),
    workflowUpdatedAt: now.toISOString(),
    workflowDueAt: createWorkflowDueAt(now),
    workflowHistory: [
      buildWorkflowEvent({
        stage: "selection_pending",
        actorName: developer,
        assigneeName: developer,
        note: "导入商品并进入选品待提交。",
        createdAt: now,
      }),
    ],
    workbookDetail: detail,
  } as Product];
}

export async function exportProductsToCommodityCreateWorkbook(products: Product[]) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const headersBySheet = getCommodityExportHeaders(products);
  const commodityRows = products.map((product) => buildCommodityExportRow(product, headersBySheet[commoditySheetName]));
  const supplierRows = products.flatMap((product) => {
    const originalRows = buildOriginalRowsForSheet(product, supplierQuoteSheetName, headersBySheet[supplierQuoteSheetName]);
    return originalRows.length ? originalRows : buildSupplierQuoteRows(product, headersBySheet[supplierQuoteSheetName]);
  });
  const countryRows = products.flatMap((product) => buildOriginalRowsForSheet(product, countryFreightSheetName, headersBySheet[countryFreightSheetName]));

  appendSheet(XLSX, workbook, commoditySheetName, headersBySheet[commoditySheetName], commodityRows);
  appendSheet(XLSX, workbook, supplierQuoteSheetName, headersBySheet[supplierQuoteSheetName], supplierRows);
  appendSheet(XLSX, workbook, countryFreightSheetName, headersBySheet[countryFreightSheetName], countryRows);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  XLSX.writeFile(workbook, `商品导出-${stamp}.xlsx`);
}

function isCommodityCreateWorkbook(workbook: import("xlsx").WorkBook, XLSX: typeof import("xlsx")) {
  const sheet = workbook.Sheets[commoditySheetName];
  if (!sheet) return false;
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  const header = rows[0] ?? [];
  return [commodityFieldAliases.sku, commodityFieldAliases.name, commodityFieldAliases.imageUrl]
    .every((aliases) => header.some((cell) => aliases.includes(cleanText(cell))));
}

function parseCommodityCreateWorkbook(
  workbook: import("xlsx").WorkBook,
  XLSX: typeof import("xlsx"),
  fileName: string,
  products: Product[],
): Product[] {
  const sheetRows = new Map<string, string[][]>();
  const headersBySheet: Record<string, string[]> = {};
  const rowsBySkuBySheet = new Map<string, Map<string, ProductSourceWorkbookRow[]>>();

  commodityVisibleSheets.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = sheet ? XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false }) : [];
    const headers = normalizeHeaders(rows[0] ?? fallbackCommodityHeaders(sheetName));
    sheetRows.set(sheetName, rows);
    headersBySheet[sheetName] = headers;

    const skuColumn = findColumnIndexByAliases(headers, commodityFieldAliases.sku);
    rows.slice(1).forEach((row, index) => {
      if (!row.some((cell) => cleanText(cell))) return;
      const sku = cleanText(row[skuColumn]);
      if (!sku) return;
      const bySheet = rowsBySkuBySheet.get(sku) ?? new Map<string, ProductSourceWorkbookRow[]>();
      const sheetProductRows = bySheet.get(sheetName) ?? [];
      sheetProductRows.push({ rowNumber: index + 2, values: rowToRecord(headers, row) });
      bySheet.set(sheetName, sheetProductRows);
      rowsBySkuBySheet.set(sku, bySheet);
    });
  });

  const commodityRows = sheetRows.get(commoditySheetName) ?? [];
  const commodityHeader = headersBySheet[commoditySheetName] ?? commodityHeaders;
  const productsWithImportedRows = [...products];
  const importedAt = new Date().toISOString();

  return commodityRows.slice(1).filter((row) => row.some((cell) => cleanText(cell))).map((row) => {
    const record = rowToRecord(commodityHeader, row);
    const importedSku = readCommodityRecord(record, "sku");
    const sku = importedSku || nextSku(productsWithImportedRows);
    const detail = createEmptyProductWorkbookDetail(readCommodityRecord(record, "name") || fileName.replace(/\.(xlsx|xls)$/i, ""));
    const sourceWorkbook = buildCommoditySourceWorkbook(fileName, importedAt, sku, headersBySheet, rowsBySkuBySheet, record);
    const product = commodityRecordToProduct(record, sku, detail, sourceWorkbook);
    productsWithImportedRows.push(product);
    return product;
  });
}

function commodityRecordToProduct(
  record: Record<string, string>,
  sku: string,
  detail: TrialProductDraft,
  sourceWorkbook: ProductSourceWorkbook,
): Product {
  const now = new Date();
  const name = readCommodityRecord(record, "name");
  const developer = readCommodityRecord(record, "developer");
  const supplierName = readCommodityRecord(record, "preferredSupplierName");
  const supplierUrl = readCommodityRecord(record, "supplierProductUrl") || readCommodityRecord(record, "purchaseUrl");
  const quote20 = parseNumber(readCommodityRecord(record, "quote20"));
  const purchasePrice = quote20 || parseNumber(readCommodityRecord(record, "purchasePrice")) || parseNumber(readCommodityRecord(record, "purchaseCost"));
  const productWeightG = convertWeightToGram(readCommodityRecord(record, "productWeight"), readCommodityRecord(record, "productWeightUnit")) || parseNumber(readCommodityRecord(record, "customsWeightG"));
  const packageWeightG = convertWeightToGram(readCommodityRecord(record, "packageWeight"), readCommodityRecord(record, "packageWeightUnit"));
  const originalImageUrls = splitList(readCommodityRecord(record, "imageUrl"));

  detail.title = name;
  detail.pricingRows = [{
    name: readCommodityRecord(record, "model") || name,
    lengthCm: parseNumber(readCommodityRecord(record, "productLengthCm")),
    widthCm: parseNumber(readCommodityRecord(record, "productWidthCm")),
    heightCm: parseNumber(readCommodityRecord(record, "productHeightCm")),
    actualWeightKg: productWeightG / 1000,
    suggestedPrice: 0,
    purchaseCost: purchasePrice,
    oceanFreightUnitPrice: 12,
    fbaFee: 0,
    exchangeRate: 6.9,
  }].filter((row) => row.name || row.purchaseCost || row.lengthCm || row.widthCm || row.heightCm);
  detail.suppliers = [{
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
  }].filter((row) => row.productUrl || row.factoryName || row.cost300 || row.moq);
  detail.remark = readCommodityRecord(record, "productNote") || readCommodityRecord(record, "purchaseNote") || readCommodityRecord(record, "quoteNote");

  return {
    sku,
    id: `prod-${sku}`,
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
    note: detail.remark,
    cancelReason: "",
    hsCode: readCommodityRecord(record, "hsCode"),
    images: originalImageUrls,
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
        note: "从商品创建模板导入商品。",
        createdAt: now,
      }),
    ],
    workbookDetail: detail,
    sourceWorkbook,
  } as Product;
}

function buildCommoditySourceWorkbook(
  fileName: string,
  importedAt: string,
  sku: string,
  headersBySheet: Record<string, string[]>,
  rowsBySkuBySheet: Map<string, Map<string, ProductSourceWorkbookRow[]>>,
  fallbackCommodityRecord: Record<string, string>,
): ProductSourceWorkbook {
  const rowsBySheet = Object.fromEntries(
    commodityVisibleSheets.map((sheetName) => {
      const rows = rowsBySkuBySheet.get(sku)?.get(sheetName) ?? [];
      if (sheetName === commoditySheetName && !rows.length) {
        return [sheetName, [{ rowNumber: 0, values: fallbackCommodityRecord }]];
      }
      return [sheetName, rows];
    }),
  );
  const allHeaders = Object.values(headersBySheet).flat();
  const mappedFieldSet = new Set(commodityMappedFields);

  return {
    kind: "commodity-create",
    importedFileName: fileName,
    importedAt,
    headersBySheet,
    rowsBySheet,
    mappedFields: commodityMappedFields.filter((field) => allHeaders.includes(field)),
    unmappedFields: allHeaders.filter((field) => field && !mappedFieldSet.has(field)),
  };
}

function createEmptyProductWorkbookDetail(title: string): TrialProductDraft {
  return {
    title,
    pricingRows: [],
    competitors: [],
    suppliers: [],
    improvement: createEmptyImprovement(),
    remark: "",
    remarkImages: [],
    keywords: [],
  };
}

function createEmptyImprovement(): TrialImprovement {
  return {
    audience: "",
    scenario: "",
    painPoint1: "",
    painPoint2: "",
    painPoint3: "",
    material: "",
    size: "",
    functionImprovement: "",
    appearance: "",
    accessories: "",
    packaging: "",
    manual: "",
    imageCopySuggestion: "",
    peakSeasonWeights: createDefaultPeakSeasonWeights(),
    peakSales: "",
    offSeasonSales: "",
    targetSales: "",
    infringement: "",
    certification: "",
    rows: [],
  };
}

function getCommodityExportHeaders(products: Product[]) {
  return {
    [commoditySheetName]: mergeHeaders(commodityHeaders, products, commoditySheetName),
    [supplierQuoteSheetName]: mergeHeaders(supplierQuoteHeaders, products, supplierQuoteSheetName),
    [countryFreightSheetName]: mergeHeaders(countryFreightHeaders, products, countryFreightSheetName),
  };
}

function mergeHeaders(baseHeaders: string[], products: Product[], sheetName: string) {
  const extraHeaders = products.flatMap((product) => product.sourceWorkbook?.kind === "commodity-create" ? product.sourceWorkbook.headersBySheet[sheetName] ?? [] : []);
  return Array.from(new Set([...baseHeaders, ...extraHeaders.filter(Boolean)]));
}

function buildCommodityExportRow(product: Product, headers: string[]) {
  const sourceValues = getFirstOriginalRow(product, commoditySheetName);
  const row = { ...sourceValues };
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  const detail = productWithWorkbook.workbookDetail;
  const firstPriceRow = detail?.pricingRows?.[0];
  const firstSupplier = detail?.suppliers?.[0];

  setCommodityRecord(row, headers, "sku", product.sku);
  setCommodityRecord(row, headers, "name", product.chineseName);
  setCommodityRecord(row, headers, "status", productStatusCommodityLabels[product.status] ?? "");
  setCommodityRecord(row, headers, "material", detail?.improvement?.material || readCommodityRecord(row, "material"));
  setCommodityRecord(row, headers, "model", firstPriceRow?.name || readCommodityRecord(row, "model"));
  setCommodityRecord(row, headers, "use", detail?.improvement?.scenario || readCommodityRecord(row, "use"));
  setCommodityRecord(row, headers, "developer", product.selectionOwner || product.developer || "");
  setCommodityRecord(row, headers, "viewer", normalizeAssigneeList(product.opsAssignee, product.opsAssignees).join(",") || product.viewableBy?.join(",") || readCommodityRecord(row, "viewer"));
  setCommodityRecord(row, headers, "imageUrl", product.images.join(","));
  setCommodityRecord(row, headers, "purchaseCost", String(product.purchasePrice || ""));
  setCommodityRecord(row, headers, "purchaseLeadTime", product.purchaseLeadTime);
  setCommodityRecord(row, headers, "productNote", product.note);
  setCommodityRecord(row, headers, "purchaseNote", product.note);
  setCommodityRecord(row, headers, "customsChineseName", readCommodityRecord(row, "customsChineseName") || product.chineseName);
  setCommodityRecord(row, headers, "customsEnglishName", product.englishName);
  setCommodityRecord(row, headers, "customsWeightG", String(product.productWeightG || ""));
  setCommodityRecord(row, headers, "hsCode", product.hsCode);
  setCommodityRecord(row, headers, "packageLengthCm", String(product.packageSizeCm.length || ""));
  setCommodityRecord(row, headers, "packageWidthCm", String(product.packageSizeCm.width || ""));
  setCommodityRecord(row, headers, "packageHeightCm", String(product.packageSizeCm.height || ""));
  setCommodityRecord(row, headers, "packageWeight", String(product.packageWeightG || ""));
  setCommodityRecord(row, headers, "packageWeightUnit", product.packageWeightG ? "g" : readCommodityRecord(row, "packageWeightUnit"));
  setCommodityRecord(row, headers, "productLengthCm", String(product.productSizeCm.length || ""));
  setCommodityRecord(row, headers, "productWidthCm", String(product.productSizeCm.width || ""));
  setCommodityRecord(row, headers, "productHeightCm", String(product.productSizeCm.height || ""));
  setCommodityRecord(row, headers, "productWeight", String(product.productWeightG || ""));
  setCommodityRecord(row, headers, "productWeightUnit", product.productWeightG ? "g" : readCommodityRecord(row, "productWeightUnit"));
  setCommodityRecord(row, headers, "preferredSupplierName", product.supplierName || firstSupplier?.factoryName || "");
  setCommodityRecord(row, headers, "minPurchaseQuantity", firstSupplier?.moq || readCommodityRecord(row, "minPurchaseQuantity"));
  setCommodityRecord(row, headers, "purchasePrice", String(product.purchasePrice || firstSupplier?.cost300 || ""));
  setCommodityRecord(row, headers, "purchaseUrl", product.supplierUrl || firstSupplier?.productUrl || "");
  setCommodityRecord(row, headers, "quote20", String(firstSupplier?.cost100 || product.purchasePrice || ""));
  setCommodityRecord(row, headers, "supplierProductUrl", firstSupplier?.productUrl || product.supplierUrl || "");
  setCommodityRecord(row, headers, "developmentDate", product.createdAt);

  return headers.map((header) => row[header] ?? "");
}

function buildOriginalRowsForSheet(product: Product, sheetName: string, headers: string[]) {
  const sourceRows = product.sourceWorkbook?.kind === "commodity-create" ? product.sourceWorkbook.rowsBySheet[sheetName] ?? [] : [];
  return sourceRows.map((row) => headers.map((header) => row.values[header] ?? ""));
}

function buildSupplierQuoteRows(product: Product, headers: string[]) {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  return (productWithWorkbook.workbookDetail?.suppliers ?? []).map((supplier, index) => {
    const row: Record<string, string> = {};
    setRecord(row, "SKU", product.sku);
    setRecord(row, "首选供应商", index === 0 ? "是" : "否");
    setRecord(row, "供应商名称", supplier.factoryName || product.supplierName);
    setRecord(row, "币种", "CNY");
    setRecord(row, "是否含税", "");
    setRecord(row, "税率", supplier.taxPoint);
    setRecord(row, "采购单价", String(supplier.cost100 || product.purchasePrice || ""));
    setRecord(row, "含税价", "");
    setRecord(row, "采购链接", supplier.productUrl || product.supplierUrl);
    setRecord(row, "报价备注", supplier.configuration);
    setRecord(row, "最小采购量", supplier.moq);
    return headers.map((header) => row[header] ?? "");
  });
}

function appendSheet(
  XLSX: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  sheetName: string,
  headers: string[],
  rows: string[][],
) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(Math.max(header.length + 4, 12), 26) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function fallbackCommodityHeaders(sheetName: string) {
  if (sheetName === countryFreightSheetName) return countryFreightHeaders;
  if (sheetName === supplierQuoteSheetName) return supplierQuoteHeaders;
  return commodityHeaders;
}

function normalizeHeaders(headers: string[]) {
  return headers.map(cleanText).filter(Boolean);
}

function rowToRecord(headers: string[], row: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, cleanText(row[index])]));
}

function readRecord(record: Record<string, string>, key: string) {
  return cleanText(record[key]);
}

function setRecord(record: Record<string, string>, key: string, value: string) {
  record[key] = value;
}

function readCommodityRecord(record: Record<string, string>, field: keyof typeof commodityFieldAliases) {
  return commodityFieldAliases[field].map((alias) => readRecord(record, alias)).find(Boolean) ?? "";
}

function setCommodityRecord(record: Record<string, string>, headers: string[], field: keyof typeof commodityFieldAliases, value: string) {
  const aliases = commodityFieldAliases[field];
  const target = aliases.find((alias) => headers.includes(alias)) ?? aliases[0];
  setRecord(record, target, value);
}

function findColumnIndexByAliases(row: string[], aliases: string[]) {
  const index = row.findIndex((cell) => aliases.includes(cleanText(cell)));
  return index >= 0 ? index : -1;
}

function getFirstOriginalRow(product: Product, sheetName: string) {
  return product.sourceWorkbook?.kind === "commodity-create"
    ? { ...(product.sourceWorkbook.rowsBySheet[sheetName]?.[0]?.values ?? {}) }
    : {};
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

function parsePricingRows(rows: string[][], headerIndex: number, endIndex: number): TrialPriceRow[] {
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => ({
    name: cleanText(row[0]),
    lengthCm: parseNumber(row[1]),
    widthCm: parseNumber(row[2]),
    heightCm: parseNumber(row[3]),
    actualWeightKg: parseNumber(row[4]),
    suggestedPrice: parseNumber(row[6]),
    purchaseCost: parseNumber(row[7]),
    oceanFreightUnitPrice: 12,
    fbaFee: parseNumber(row[8]),
    exchangeRate: parseNumber(row[13]) || 6.9,
  })).filter((row) => row.name);
}

function parseCompetitorRows(rows: string[][], headerIndex: number, endIndex: number): TrialCompetitorRow[] {
  if (headerIndex < 0) {
    return [];
  }

  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => {
    const price = cleanText(row[7]);
    return {
      type: cleanText(row[0]),
      hotVariantImage: "",
      asin: cleanText(row[1]),
      sales30Days: cleanText(row[2]),
      variantCount: cleanText(row[3]),
      variantType: cleanText(row[4]),
      hotVariantSpec: cleanText(row[6]),
      hotVariantPrice: removeFbaFromPrice(price),
      fbaFee: extractFbaFee(price),
      priceChangeNote: cleanText(row[8]),
      reviewCount: cleanText(row[9]),
      rating: cleanText(row[10]),
      negativePoint1: cleanText(row[11]),
      negativePoint2: cleanText(row[12]),
      negativePoint3: cleanText(row[13]),
      negativePoint4: cleanText(row[14]),
      negativePoint5: cleanText(row[15]),
      packageSize: cleanText(row[16]),
      note: cleanText(row[17]),
      noteImage: "",
    };
  }).filter((row) => Object.values(row).some((value) => cleanText(value)));
}

function parseSupplierRows(rows: string[][], headerIndex: number, endIndex: number): TrialSupplierRow[] {
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => ({
    productUrl: cleanText(row[0]),
    factoryName: cleanText(row[1]),
    configuration: cleanText(row[2]),
    moq: cleanText(row[3]),
    leadTime: cleanText(row[4]),
    domesticFreightIncluded: cleanText(row[5]),
    certifications: cleanText(row[6]),
    patentCountry: cleanText(row[7]),
    packagingMethod: cleanText(row[8]),
    cost100: parseNumber(row[9]),
    cost300: parseNumber(row[10]),
    taxPoint: cleanText(row[11]),
    invoiceName: cleanText(row[12]),
    invoiceSpecUnit: cleanText(row[13]),
    invoiceRegion: cleanText(row[14]),
  }));
}

function parseImprovementRows(rows: string[][], headerIndex: number, endIndex: number): TrialImprovement {
  if (headerIndex < 0) {
    return createEmptyImprovement();
  }

  const header = rows[headerIndex] ?? [];
  const value = headerIndex + 1 < endIndex ? rows[headerIndex + 1] ?? [] : [];
  const read = (label: string) => cleanText(value[findColumnIndex(header, label)]);
  const improvementRow = {
    ...createEmptyImprovementRow(),
    material: read("材质改进"),
    size: read("尺寸改进"),
    functionImprovement: read("功能改进"),
    appearance: read("外观"),
    accessories: read("配件"),
    packaging: read("包装改进"),
    manual: read("说明书"),
    imageCopySuggestion: read("文案"),
    certification: "",
  };

  return {
    ...createEmptyImprovement(),
    audience: read("使用人群"),
    scenario: read("主要适用场景"),
    painPoint1: read("产品痛点1"),
    painPoint2: read("产品痛点2"),
    painPoint3: read("产品痛点3"),
    material: read("材质改进"),
    size: read("尺寸改进"),
    functionImprovement: read("功能改进"),
    appearance: read("外观"),
    accessories: read("配件"),
    packaging: read("包装改进"),
    manual: read("说明书"),
    imageCopySuggestion: read("文案"),
    peakSeasonWeights: normalizePeakSeasonWeights(read("旺季月份")),
    peakSales: read("头部旺季平均销量"),
    offSeasonSales: read("头部淡季平均销量"),
    targetSales: read("目标销量"),
    infringement: read("侵权"),
    certification: read("认证"),
    rows: Object.values(improvementRow).some(Boolean) ? [improvementRow] : [],
  };
}

function parseKeywordRows(rows: string[][], headerIndex: number, endIndex: number): TrialKeywordRow[] {
  if (headerIndex < 0) {
    return [];
  }

  return rows.slice(headerIndex + 1, endIndex).filter((row) => cleanText(row[0])).map((row) => ({
    keyword: cleanText(row[0]),
    cpc: parseNumber(row[1]),
    monthlySearches: parseNumber(row[2]),
    abaRank: parseNumber(row[3]),
  }));
}

async function extractWorkbookImages(buffer: ArrayBuffer, JSZip: { loadAsync: (data: ArrayBuffer) => Promise<{ files: Record<string, { async: (type: "string" | "base64") => Promise<string> }> }> }) {
  const zip = await JSZip.loadAsync(buffer);
  const drawingPath = Object.keys(zip.files).find((path) => path.startsWith("xl/drawings/") && path.endsWith(".xml"));
  const relPath = drawingPath ? `xl/drawings/_rels/${drawingPath.split("/").pop()}.rels` : "";
  const drawingFile = drawingPath ? zip.files[drawingPath] : null;
  const relFile = relPath ? zip.files[relPath] : null;

  if (!drawingFile || !relFile) {
    return [];
  }

  const [drawingXml, relXml] = await Promise.all([drawingFile.async("string"), relFile.async("string")]);
  const rels = parseDrawingRelationships(relXml);
  const parser = new DOMParser();
  const drawing = parser.parseFromString(drawingXml, "application/xml");
  const anchors = Array.from(drawing.getElementsByTagNameNS("*", "twoCellAnchor"));
  const images: Array<{ row: number; col: number; dataUrl: string }> = [];

  for (const anchor of anchors) {
    const from = anchor.getElementsByTagNameNS("*", "from")[0];
    const blip = anchor.getElementsByTagNameNS("*", "blip")[0];
    const relId = blip?.getAttribute("r:embed") ?? blip?.getAttribute("embed");
    const target = relId ? rels.get(relId) : "";
    if (!from || !target) {
      continue;
    }

    const mediaPath = `xl/${target.startsWith("../") ? target.slice(3) : target}`;
    const media = zip.files[mediaPath];
    if (!media) {
      continue;
    }

    const bytes = await media.async("base64");
    images.push({
      col: Number(from.getElementsByTagNameNS("*", "col")[0]?.textContent ?? 0),
      row: Number(from.getElementsByTagNameNS("*", "row")[0]?.textContent ?? 0),
      dataUrl: `data:${mimeFromPath(mediaPath)};base64,${bytes}`,
    });
  }

  return images;
}

function parseDrawingRelationships(xml: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const rels = new Map<string, string>();
  Array.from(document.getElementsByTagNameNS("*", "Relationship")).forEach((rel) => {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target && target !== "NULL") {
      rels.set(id, target);
    }
  });
  return rels;
}

function textAt(rows: string[][], row: number, col: number) {
  return cleanText(rows[row]?.[col]);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function parseNumber(value: unknown) {
  const text = cleanText(value).replace(/[$,%]/g, "").replace(/,/g, "");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function findRowIndex(rows: string[][], label: string) {
  const index = rows.findIndex((row) => row.some((cell) => cleanText(cell).includes(label)));
  return index >= 0 ? index : 0;
}

function findOptionalRowIndex(rows: string[][], label: string) {
  return rows.findIndex((row) => row.some((cell) => cleanText(cell).includes(label)));
}

function findNextRowIndex(fallback: number, currentIndex: number, candidates: number[]) {
  if (currentIndex < 0) {
    return fallback;
  }

  return candidates
    .filter((index) => index > currentIndex)
    .sort((left, right) => left - right)[0] ?? fallback;
}

function findColumnIndex(row: string[], label: string) {
  const index = row.findIndex((cell) => cleanText(cell).includes(label));
  return index >= 0 ? index : -1;
}

function extractFbaFee(value: string) {
  const fbaLine = value
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes("fba"));
  if (!fbaLine) return "";
  const amount = fbaLine
    .replace(/fba/iu, "")
    .replace(/[:：$]/gu, " ")
    .trim()
    .split(/\s+/u)[0];
  return amount && Number.isFinite(Number(amount)) ? amount : "";
}

function removeFbaFromPrice(value: string) {
  return value.split(/\r?\n/).filter((line) => !/FBA/i.test(line)).join("\n").trim();
}

function mimeFromPath(path: string) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function extractDeveloperName(fileName: string) {
  const baseName = fileName.replace(/\.(xlsx|xls)$/i, "");
  const parts = baseName.split("-");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}


export function productToDraft(product: Product | null, products: Product[]): ProductEditorDraft {
  if (product) {
    const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
    return {
      ...product,
      cancelReason: product.cancelReason ?? "",
      competitorAsins: product.competitorAsins.length ? product.competitorAsins : [""],
      opsAssignees: normalizeAssigneeList(product.opsAssignee, product.opsAssignees),
      designerAssignees: normalizeAssigneeList(product.designerAssignee, product.designerAssignees),
      workflowStage: getProductWorkflowStage(product),
      workflowHistory: product.workflowHistory ?? [],
      operationsProgress: normalizeOperationsProgress(product.operationsProgress, product.opsAssignee || product.selectionOwner || ""),
      workbookDetail: normalizeWorkbookDetail(
        productWithWorkbook.workbookDetail,
        createEmptyProductWorkbookDetail(product.chineseName || ""),
      ),
    };
  }

  return {
    sku: nextSku(products),
    chineseName: "",
    englishName: "",
    asin: "",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: ["", ""],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: emptySize,
    packageSizeCm: emptySize,
    workflowStage: "selection_pending",
    opsAssignees: [],
    designerAssignees: [],
    workflowHistory: [],
    workbookDetail: createEmptyProductWorkbookDetail(""),
  };
}

export function hydrateProductFromExcelSeed(product: Product): Product {
  return product;
}

function normalizeWorkbookDetail(detail: TrialProductDraft | undefined, fallback: TrialProductDraft): TrialProductDraft {
  if (!detail) {
    return fallback;
  }

  const fallbackImprovement = createEmptyImprovement();
  const sourceImprovement = detail.improvement ?? fallbackImprovement;

  return {
    ...fallback,
    ...detail,
    pricingRows: detail.pricingRows?.length
      ? detail.pricingRows.map((row) => ({ ...row, oceanFreightUnitPrice: row.oceanFreightUnitPrice ?? 12 }))
      : fallback.pricingRows,
    competitors: detail.competitors?.length
      ? detail.competitors.map((row) => ({
          ...row,
          hotVariantImage: row.hotVariantImage ?? "",
          fbaFee: row.fbaFee ?? "",
          negativePoint5: row.negativePoint5 ?? "",
          noteImage: row.noteImage ?? "",
        }))
      : [],
    suppliers: detail.suppliers?.length ? detail.suppliers : fallback.suppliers,
    improvement: {
      ...fallbackImprovement,
      ...sourceImprovement,
      peakSeasonWeights: normalizePeakSeasonWeights(
        (sourceImprovement as TrialImprovement & { peakSeason?: unknown }).peakSeasonWeights
        ?? (sourceImprovement as TrialImprovement & { peakSeason?: unknown }).peakSeason,
      ),
      rows: sourceImprovement.rows?.length
        ? sourceImprovement.rows.map((row) => ({ ...createEmptyImprovementRow(), ...row }))
        : [],
    },
    remarkImages: detail.remarkImages ?? fallback.remarkImages ?? [],
    keywords: detail.keywords?.length ? detail.keywords : [],
  };
}

export const trialImprovementLabels: Record<Exclude<keyof TrialImprovement, "rows">, string> = {
  audience: "使用人群",
  scenario: "主要适用场景",
  painPoint1: "产品痛点1",
  painPoint2: "产品痛点2",
  painPoint3: "产品痛点3",
  material: "材质改进",
  size: "尺寸改进",
  functionImprovement: "功能改进",
  appearance: "外观（款式）",
  accessories: "配件（搭配）",
  packaging: "包装改进",
  manual: "说明书",
  imageCopySuggestion: "文案/主/附图片建议",
  peakSeasonWeights: "旺季月份权重",
  peakSales: "头部旺季平均销量",
  offSeasonSales: "头部淡季平均销量",
  targetSales: "目标销量",
  infringement: "侵权（专利/产权）",
  certification: "认证",
};

export function createTrialProductDraft(): TrialProductDraft {
  return {
    title: "交易卡展示架",
    pricingRows: [
      { name: "交易卡展示架10pcs", lengthCm: 18.5, widthCm: 15, heightCm: 8, actualWeightKg: 0.6, suggestedPrice: 23.99, purchaseCost: 35, oceanFreightUnitPrice: 12, fbaFee: 5.42, exchangeRate: 6.8 },
      { name: "交易卡展示架24pcs", lengthCm: 25, widthCm: 20, heightCm: 8, actualWeightKg: 1.2, suggestedPrice: 37.99, purchaseCost: 76.8, oceanFreightUnitPrice: 12, fbaFee: 6.67, exchangeRate: 6.8 },
    ],
    competitors: [],
    suppliers: [
      { productUrl: "", factoryName: "广州飞伦工艺品有限公司", configuration: "", moq: "1000", leadTime: "", domesticFreightIncluded: "否", certifications: "无", patentCountry: "", packagingMethod: "", cost100: 3.5, cost300: 35, taxPoint: "普票2%", invoiceName: "", invoiceSpecUnit: "", invoiceRegion: "" },
    ],
    improvement: createEmptyImprovement(),
    remark: "",
    remarkImages: [],
    keywords: [],
  };
}
