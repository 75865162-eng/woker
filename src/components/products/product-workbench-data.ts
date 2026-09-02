import type { Product, ProductListItem } from "@/lib/products/types";
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

export async function parseProductWorkbookFile(file: File, products: Array<Pick<Product, "sku">>, preferredSku?: string): Promise<Product> {
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
  const detail = createTrialProductDraft();
  const pricingHeaderIndex = 0;
  const competitorHeaderIndex = findRowIndex(rows, "ASIN");
  const supplierHeaderIndex = findRowIndex(rows, "供应商产品链接");
  const improvementHeaderIndex = findRowIndex(rows, "使用人群");
  const keywordHeaderIndex = findRowIndex(rows, "关键词");

  detail.title = textAt(rows, pricingHeaderIndex + 1, 0) || file.name.replace(/\.(xlsx|xls)$/i, "");
  detail.pricingRows = parsePricingRows(rows, pricingHeaderIndex, competitorHeaderIndex);
  detail.competitors = parseCompetitorRows(rows, competitorHeaderIndex, supplierHeaderIndex);
  detail.suppliers = parseSupplierRows(rows, supplierHeaderIndex, improvementHeaderIndex);
  detail.improvement = parseImprovementRows(rows, improvementHeaderIndex);
  detail.keywords = parseKeywordRows(rows, keywordHeaderIndex);
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

  const sku = preferredSku || nextSku(products);
  const now = new Date();
  const developer = extractDeveloperName(file.name);

  return {
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
  } as Product;
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
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => {
    const price = cleanText(row[7]);
    return {
      type: cleanText(row[0]) || "参考竞品",
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
  }).filter((row) => row.asin || row.type);
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

function parseImprovementRows(rows: string[][], headerIndex: number): TrialImprovement {
  const header = rows[headerIndex] ?? [];
  const value = rows[headerIndex + 1] ?? [];
  const fallback = createTrialProductDraft().improvement;
  const read = (label: string) => cleanText(value[findColumnIndex(header, label)]);

  return {
    ...fallback,
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
    rows: [{
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
    }],
  };
}

function parseKeywordRows(rows: string[][], headerIndex: number): TrialKeywordRow[] {
  return rows.slice(headerIndex + 1).filter((row) => cleanText(row[0])).map((row) => ({
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


export function productToDraft(product: Product | null, products: Array<Pick<ProductListItem, "sku">>, preferredSku?: string): ProductEditorDraft {
  if (product) {
    const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
    const competitorAsins = Array.isArray(product.competitorAsins) ? product.competitorAsins : [];
    return {
      ...product,
      cancelReason: product.cancelReason ?? "",
      conclusionExcelFile: product.conclusionExcelFile,
      images: Array.isArray(product.images) ? product.images : [],
      competitorAsins: competitorAsins.length ? competitorAsins : [""],
      opsAssignees: normalizeAssigneeList(product.opsAssignee, product.opsAssignees),
      designerAssignees: normalizeAssigneeList(product.designerAssignee, product.designerAssignees),
      workflowStage: getProductWorkflowStage(product),
      workflowHistory: Array.isArray(product.workflowHistory) ? product.workflowHistory : [],
      operationsProgress: normalizeOperationsProgress(product.operationsProgress, product.opsAssignee || product.selectionOwner || ""),
      workbookDetail: normalizeWorkbookDetail(
        productWithWorkbook.workbookDetail,
        product.sku === "00001" ? createEspressoMirrorDetail() : createTrialProductDraft(),
      ),
    };
  }

  return {
    sku: preferredSku || nextSku(products),
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
    conclusionExcelFile: undefined,
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
    workbookDetail: createBlankWorkbookDetail(),
  };
}

export function hydrateProductFromExcelSeed(product: Product): Product {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  if (product.sku !== "00001" || productWithWorkbook.workbookDetail) {
    return product;
  }

  return {
    ...product,
    chineseName: "浓缩咖啡机镜子",
    englishName: "Espresso Shot Mirror",
    asin: "",
    developer: "黄斯涵",
    purchasePrice: 6.5405,
    status: "developing",
    supplierName: "深圳泰沃数码科技有限公司",
    supplierUrl: "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0",
    specs: "普通磁铁 / 强磁;底座+引磁片",
    purchaseLeadTime: "",
    createdAt: product.createdAt.includes(":") ? product.createdAt : `${product.createdAt || "2026-07-23"} 20:37:13`,
    keywords: "espresso shot mirror,espresso mirror",
    note: "咖啡爱好者 / 咖啡师用于观察咖啡液流出形态；重点改进强磁底座、3M背胶引磁片、飞机盒和说明书。",
    hsCode: "",
    competitorAsins: ["B0D2WNHF3V", "B0BJP1FM72", "B0DM1TB116", "B0F9Y1C7MZ", "B0GVDVJDVH", "B0BXCLX3HC"],
    productWeightG: 100,
    packageWeightG: 108.86,
    productSizeCm: { length: 10, width: 10, height: 5 },
    packageSizeCm: { length: 9.14, width: 9.14, height: 5.33 },
    workbookDetail: createEspressoMirrorDetail(),
  } as Product;
}

function normalizeWorkbookDetail(detail: TrialProductDraft | undefined, fallback: TrialProductDraft): TrialProductDraft {
  if (!detail) {
    return fallback;
  }

  const fallbackImprovement = createTrialProductDraft().improvement;
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
      : fallback.competitors,
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
        : fallbackImprovement.rows,
    },
    remarkImages: detail.remarkImages ?? fallback.remarkImages ?? [],
    keywords: detail.keywords?.length ? detail.keywords : fallback.keywords,
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
  peakSeasonWeights: "旺季月份",
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
    competitors: [
      { type: "头部竞品", hotVariantImage: "", asin: "B0GL1XGNQM", sales30Days: "849 / 2026-02-14", variantCount: "5", variantType: "数量", hotVariantSpec: "17.5*8.5*2", hotVariantPrice: "40.88 / 750g", fbaFee: "5.76", priceChangeNote: "42.99-59.99", reviewCount: "13", rating: "4.5", negativePoint1: "希望它们再抬高一点", negativePoint2: "", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "18.29 x 13.72 x 8.64 cm", note: "杂", noteImage: "" },
      { type: "直接竞品", hotVariantImage: "", asin: "B0GVSNLDYF", sales30Days: "160 / 2026-05-09", variantCount: "", variantType: "", hotVariantSpec: "16.2*8.4*1.3", hotVariantPrice: "25.99 / 680g", fbaFee: "5.61", priceChangeNote: "28.9-31.99", reviewCount: "19", rating: "4.3", negativePoint1: "", negativePoint2: "", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "42.67 x 17.78 x 9.91 cm", note: "杂", noteImage: "" },
      { type: "参考竞品", hotVariantImage: "", asin: "B0GYF4D1B5", sales30Days: "201 / 2026-05-03", variantCount: "", variantType: "", hotVariantSpec: "16*8.5", hotVariantPrice: "59.97 / 1100g", fbaFee: "6.58", priceChangeNote: "69.97-59.97", reviewCount: "26", rating: "4.8", negativePoint1: "没这么牢固，有锁扣更好", negativePoint2: "黑色丙烯看起来非常干净", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "18.80 x 15.75 x 9.65 cm", note: "收纳居多", noteImage: "" },
    ],
    suppliers: [
      { productUrl: "", factoryName: "广州飞伦工艺品有限公司", configuration: "", moq: "1000", leadTime: "", domesticFreightIncluded: "否", certifications: "无", patentCountry: "", packagingMethod: "", cost100: 3.5, cost300: 35, taxPoint: "普票2%", invoiceName: "", invoiceSpecUnit: "", invoiceRegion: "" },
    ],
    improvement: {
      audience: "卡片爱好者",
      scenario: "家中",
      painPoint1: "可以考虑怎么加锁扣或者防滑",
      painPoint2: "去掉 logo，做差异化镂空之类的",
      painPoint3: "采样看看品控",
      material: "亚克力",
      size: "17.5*8.5",
      functionImprovement: "收纳整理、展示",
      appearance: "",
      accessories: "可以配一个收纳袋",
      packaging: "前期先牛皮纸盒，后期看有没有必要加彩盒",
      manual: "简单产品介绍显得专业",
      imageCopySuggestion: "",
      peakSeasonWeights: createDefaultPeakSeasonWeights(),
      peakSales: "400-500",
      offSeasonSales: "",
      targetSales: "100",
      infringement: "",
      certification: "",
      rows: [
        {
          material: "亚克力",
          size: "17.5*8.5",
          functionImprovement: "收纳整理、展示",
          appearance: "",
          accessories: "可以配一个收纳袋",
          packaging: "前期先牛皮纸盒，后期看有没有必要加彩盒",
          manual: "简单产品介绍显得专业",
          imageCopySuggestion: "",
          certification: "",
        },
      ],
    },
    remark: "",
    remarkImages: [],
    keywords: [
      { keyword: "card risers for display case", cpc: 0.4, monthlySearches: 4401, abaRank: 317832 },
      { keyword: "graded card display", cpc: 1.53, monthlySearches: 11912, abaRank: 124848 },
      { keyword: "sports card display", cpc: 0.72, monthlySearches: 9331, abaRank: 150351 },
      { keyword: "sports card display case", cpc: 1.54, monthlySearches: 7112, abaRank: 213697 },
      { keyword: "card display case", cpc: 1.84, monthlySearches: 31321, abaRank: 42337 },
      { keyword: "pokemon card display", cpc: 0.86, monthlySearches: 10715, abaRank: 154350 },
    ],
  };
}

function createEspressoMirrorDetail(): TrialProductDraft {
  return {
    title: "浓缩咖啡机镜子",
    pricingRows: [
      { name: "普通磁铁", lengthCm: 10, widthCm: 10, heightCm: 5, actualWeightKg: 0.1, suggestedPrice: 13.99, purchaseCost: 6.5405, oceanFreightUnitPrice: 12, fbaFee: 3.73, exchangeRate: 6.9 },
      { name: "强磁", lengthCm: 6.5, widthCm: 4, heightCm: 7.5, actualWeightKg: 0.11, suggestedPrice: 13.99, purchaseCost: 8.034, oceanFreightUnitPrice: 12, fbaFee: 3.73, exchangeRate: 6.9 },
    ],
    competitors: [
      {
        type: "头部竞品",
        hotVariantImage: "",
        asin: "B0D2WNHF3V",
        sales30Days: "427\n2024-05-07",
        variantCount: "2",
        variantType: "底座颜色（银色、黑色）",
        hotVariantSpec: "银色底座\n不锈钢镜面\n108.86 g",
        hotVariantPrice: "13.80\ncoupon11.73",
        fbaFee: "3.86",
        priceChangeNote: "/",
        reviewCount: "198",
        rating: "4.6",
        negativePoint1: "尺寸偏大，适配性差（13）\n镜子太大\n机身高度不足无法使用",
        negativePoint2: "磁吸 / 粘贴结构不稳（8）\n磁吸力度不足\n配套背胶贴片粘性差\n部分咖啡机机身无磁性用不了",
        negativePoint3: "镜面材质效果不佳（11）\n不锈钢镜子清晰度一般，成像偏暗\n支架 / 调节结构缺陷（7）\n调节关节阻尼偏大\n支架臂长度不足",
        negativePoint4: "配件与附加工具问题（4）\n无说明书",
        negativePoint5: "外观设计短板（2）\n质感一般\n不精致",
        packageSize: "9.14 x 9.14 x 5.33 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0BJP1FM72",
        sales30Days: "161\n2022-11-14",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "黑色底座\n玻璃镜面\n90.72 g",
        hotVariantPrice: "14.99",
        fbaFee: "3.86",
        priceChangeNote: "/",
        reviewCount: "256",
        rating: "4.5",
        negativePoint1: "配套金属贴片背胶品质差（4）\n引磁片双面胶老化\n粘合力不足",
        negativePoint2: "磁吸性能不稳定（4）\n磁铁吸力不足\n用户不愿意在咖啡机身粘胶",
        negativePoint3: "支架结构缺陷（5）\n支架臂长度偏短\n万向球头最大转角不足90度\n稳定性差",
        negativePoint4: "镜面相关问题（5）\n玻璃边角磕碰缺角\n无放大效果\n咖啡污渍附着后清洁难度偏高",
        negativePoint5: "缺少配套说明书（3）\n无说明书",
        packageSize: "7.87 x 7.62 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0DM1TB116",
        sales30Days: "87\n2024-11-20",
        variantCount: "2",
        variantType: "底座颜色（银色、黑色）",
        hotVariantSpec: "银色底座\n不锈钢镜面\n81.65 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.01",
        priceChangeNote: "7.89-9.99",
        reviewCount: "36",
        rating: "4.4",
        negativePoint1: "产品做工粗糙廉价（1）\n整体用料做工差、品质低劣",
        negativePoint2: "镜面尺寸偏大（3）\n镜面规格过大\n部分机型安装后干涉配件摆放",
        negativePoint3: "外观设计简陋（1）\n镜面无包边装饰\n不锈钢镜面材质缺陷（3）\n容易刮花\n粘指纹\n比不上玻璃镜面",
        negativePoint4: "使用环境易起雾（1）\n出厂零配件带油污（1）",
        negativePoint5: "",
        packageSize: "8.89 x 7.87 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0F9Y1C7MZ",
        sales30Days: "64\n2025-07-10",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "银色底座\n不锈钢镜面\n81.65 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.01",
        priceChangeNote: "/",
        reviewCount: "13",
        rating: "4.3",
        negativePoint1: "磁吸相关问题（3）\n咖啡机不锈钢不带磁\n引磁片背胶粘不住\n磁铁吸力弱",
        negativePoint2: "机型空间适配不足（1）\n适配机型不足",
        negativePoint3: "镜片尺寸偏小（1）",
        negativePoint4: "镜面出场瑕疵（1）",
        negativePoint5: "",
        packageSize: "8.38 x 7.87 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0GVDVJDVH",
        sales30Days: "76\n2026-05-21",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "银色底座\n不锈钢镜面\n90.72 g",
        hotVariantPrice: "7.99",
        fbaFee: "3.01",
        priceChangeNote: "/",
        reviewCount: "3",
        rating: "3.9",
        negativePoint1: "质量差",
        negativePoint2: "",
        negativePoint3: "",
        negativePoint4: "",
        negativePoint5: "",
        packageSize: "",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0BXCLX3HC",
        sales30Days: "42\n2023-03-03",
        variantCount: "4",
        variantType: "",
        hotVariantSpec: "黑色底座\n木头镜子\n81.93 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.73",
        priceChangeNote: "/",
        reviewCount: "203",
        rating: "3.9",
        negativePoint1: "运输破损严重，包装防护不足（12）\n镜子碎，底座破损",
        negativePoint2: "热胀冷缩导致玻璃开裂（9）\n装配公差过紧，玻璃膨胀崩裂",
        negativePoint3: "做工粗糙、用料差（3）\n1.木头表面工艺粗糙\n2.底座装配错位\n3.木框为未处理原木，遇水吸水膨胀\n4.漆面 / 木饰面质感差",
        negativePoint4: "磁吸相关缺陷（5）\n磁铁吸力偏弱\n配套引磁贴片不适合经常擦拭的接水盘",
        negativePoint5: "结构设计缺陷（5）\n仅有单旋转支点，调节角度有限\n支架臂偏短，调节范围不足\n擦拭时玻璃容易脱落\n边框尺寸偏大，挤占接水盘空间",
        packageSize: "",
        note: "",
        noteImage: "",
      },
    ],
    suppliers: [
      {
        productUrl: "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0",
        factoryName: "深圳泰沃数码科技有限公司",
        configuration: "底座+2片引磁片",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "开窗纸盒\n\n换飞机盒",
        cost100: 0,
        cost300: 6.5,
        taxPoint: "普票3个点开票免费",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/992102683422.html?spm=a26352.13672862.offerlist.30.4c961e62TBS4cq&cosite=-&tracelog=p4p&_p_isad=1&clickid=12136426181a4fc5ada1168d16a05051&sessionid=bce541a9bb314e8e974468aba916b0d3",
        factoryName: "东莞市科世达包装制品有限公司",
        configuration: "飞机盒",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.3,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/999202581627.html?spm=a262uh.11734184.footprint-offer-list-offer3.2.35b92ef6DiT714",
        factoryName: "义乌市子漫工艺品有限公司",
        configuration: "镜子7cm",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.75,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/972335245714.html?spm=a262uh.11734184.footprint-offer-list-offer4.2.35b92ef6DiT714",
        factoryName: "金华荀梦电子商务有限责任公司",
        configuration: "镜子6cm",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.43,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
    ],
    improvement: {
      audience: "咖啡爱好者，咖啡师",
      scenario: "观察咖啡液流出的形态",
      painPoint1: "强磁底座",
      painPoint2: "3M背胶引磁片，我们自己测试粘在不锈钢上会不会掉",
      painPoint3: "否",
      material: "否",
      size: "否",
      functionImprovement: "否",
      appearance: "否",
      accessories: "无",
      packaging: "飞机盒",
      manual: "做使用说明书",
      imageCopySuggestion: "",
      peakSeasonWeights: createDefaultPeakSeasonWeights(),
      peakSales: "",
      offSeasonSales: "500",
      targetSales: "150",
      infringement: "",
      certification: "",
      rows: [
        {
          material: "否",
          size: "否",
          functionImprovement: "否",
          appearance: "否",
          accessories: "无",
          packaging: "飞机盒",
          manual: "做使用说明书",
          imageCopySuggestion: "",
          certification: "",
        },
      ],
    },
    remark: "成本拆分：普通磁铁=支架5.05+税0.1515+飞机盒0.3+镜子1+税0.039；强磁=支架6.5+税0.195+飞机盒0.3+镜子1+税0.039。",
    remarkImages: [],
    keywords: [
      { keyword: "espresso shot mirror", cpc: 0.63, monthlySearches: 488, abaRank: 1756622 },
      { keyword: "espresso mirror", cpc: 0.49, monthlySearches: 1539, abaRank: 1155349 },
    ],
  };
}

function createBlankWorkbookDetail(): TrialProductDraft {
  const blankPriceRow: TrialPriceRow = {
    name: "",
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    actualWeightKg: 0,
    suggestedPrice: 0,
    purchaseCost: 0,
    oceanFreightUnitPrice: 12,
    fbaFee: 0,
    exchangeRate: 6.9,
  };

  const blankCompetitorRow: TrialCompetitorRow = {
    type: "",
    hotVariantImage: "",
    asin: "",
    sales30Days: "",
    variantCount: "",
    variantType: "",
    hotVariantSpec: "",
    hotVariantPrice: "",
    fbaFee: "",
    priceChangeNote: "",
    reviewCount: "",
    rating: "",
    negativePoint1: "",
    negativePoint2: "",
    negativePoint3: "",
    negativePoint4: "",
    negativePoint5: "",
    packageSize: "",
    note: "",
    noteImage: "",
  };

  const blankSupplierRow: TrialSupplierRow = {
    productUrl: "",
    factoryName: "",
    configuration: "",
    moq: "",
    leadTime: "",
    domesticFreightIncluded: "",
    certifications: "",
    patentCountry: "",
    packagingMethod: "",
    cost100: 0,
    cost300: 0,
    taxPoint: "",
    invoiceName: "",
    invoiceSpecUnit: "",
    invoiceRegion: "",
  };

  return {
    title: "",
    pricingRows: [blankPriceRow],
    competitors: [blankCompetitorRow],
    suppliers: [blankSupplierRow],
    improvement: {
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
      rows: [createEmptyImprovementRow()],
    },
    remark: "",
    remarkImages: [],
    keywords: [],
  };
}
