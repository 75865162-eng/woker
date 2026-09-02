import type { ProductDraft, ProductSizeCm, ProductStatus } from "@/lib/products/types";

export const storageKey = "amazon-bulk-ad-products-v2";
export const trialStorageKey = "amazon-bulk-ad-trial-products-v1";
export const pageSizeOptions = [20, 50, 100];
export const emptySize: ProductSizeCm = { length: 0, width: 0, height: 0 };
export const overdueThresholdDays = 7;

export type ProductStatusFilter = "all" | "overdue" | "design_in_progress" | "operations_progress" | ProductStatus;

export type TrialPriceRow = {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  actualWeightKg: number;
  suggestedPrice: number;
  purchaseCost: number;
  oceanFreightUnitPrice: number;
  fbaFee: number;
  exchangeRate: number;
};

export type TrialCompetitorRow = {
  type: string;
  hotVariantImage: string;
  asin: string;
  sales30Days: string;
  variantCount: string;
  variantType: string;
  hotVariantSpec: string;
  hotVariantPrice: string;
  fbaFee: string;
  priceChangeNote: string;
  reviewCount: string;
  rating: string;
  negativePoint1: string;
  negativePoint2: string;
  negativePoint3: string;
  negativePoint4: string;
  negativePoint5: string;
  packageSize: string;
  note: string;
  noteImage: string;
};

export type TrialSupplierRow = {
  productUrl: string;
  factoryName: string;
  configuration: string;
  moq: string;
  leadTime: string;
  domesticFreightIncluded: string;
  certifications: string;
  patentCountry: string;
  packagingMethod: string;
  cost100: number;
  cost300: number;
  taxPoint: string;
  invoiceName: string;
  invoiceSpecUnit: string;
  invoiceRegion: string;
};

export type TrialImprovementCellKey =
  | "material"
  | "size"
  | "functionImprovement"
  | "appearance"
  | "accessories"
  | "packaging"
  | "manual"
  | "imageCopySuggestion"
  | "certification";

export type TrialImprovementRow = Record<TrialImprovementCellKey, string>;

export type TrialImprovement = {
  audience: string;
  scenario: string;
  painPoint1: string;
  painPoint2: string;
  painPoint3: string;
  material: string;
  size: string;
  functionImprovement: string;
  appearance: string;
  accessories: string;
  packaging: string;
  manual: string;
  imageCopySuggestion: string;
  peakSeasonWeights: number[];
  peakSales: string;
  offSeasonSales: string;
  targetSales: string;
  infringement: string;
  certification: string;
  rows: TrialImprovementRow[];
};

export type TrialKeywordRow = {
  keyword: string;
  cpc: number;
  monthlySearches: number;
  abaRank: number;
};

export type TrialProductDraft = {
  id?: string;
  title: string;
  pricingRows: TrialPriceRow[];
  competitors: TrialCompetitorRow[];
  suppliers: TrialSupplierRow[];
  improvement: TrialImprovement;
  remark: string;
  remarkImages: string[];
  keywords: TrialKeywordRow[];
};

export type ProductEditorDraft = ProductDraft & {
  workbookDetail: TrialProductDraft;
};

export type ProductFilters = {
  keyword: string;
  asin: string;
  opsAssignees: string[];
  selectionOwners: string[];
  designerAssignees: string[];
  mySkuOwner: string;
  supplierName: string;
  status: ProductStatusFilter;
  minPrice: string;
  maxPrice: string;
};

export const initialFilters: ProductFilters = {
  keyword: "",
  asin: "",
  opsAssignees: [],
  selectionOwners: [],
  designerAssignees: [],
  mySkuOwner: "",
  supplierName: "",
  status: "all",
  minPrice: "",
  maxPrice: "",
};

export const competitorTypeOptions = ["头部竞品", "直接竞品", "参考竞品"];
export const competitorTextFields: Array<Exclude<keyof TrialCompetitorRow, "type" | "hotVariantImage" | "asin" | "note" | "noteImage">> = [
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
  "packageSize",
];
export const compactCompetitorFields = new Set<keyof TrialCompetitorRow>([
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
]);
export const negativeCompetitorFields = new Set<keyof TrialCompetitorRow>([
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
]);
export const supplierFields: Array<keyof TrialSupplierRow> = [
  "productUrl",
  "factoryName",
  "configuration",
  "moq",
  "leadTime",
  "domesticFreightIncluded",
  "certifications",
  "patentCountry",
  "packagingMethod",
  "cost100",
  "cost300",
  "taxPoint",
  "invoiceRegion",
];
export const wideSupplierFields = new Set<keyof TrialSupplierRow>(["productUrl", "factoryName", "configuration", "moq"]);
export const mediumSupplierFields = new Set<keyof TrialSupplierRow>(["packagingMethod"]);
export const extraWideSupplierFields = new Set<keyof TrialSupplierRow>(["taxPoint", "invoiceRegion"]);
export const improvementColumns: Array<{ field: TrialImprovementCellKey; label: string }> = [
  { field: "material", label: "材质改进" },
  { field: "size", label: "尺寸改进" },
  { field: "functionImprovement", label: "功能改进" },
  { field: "appearance", label: "外观（款式）" },
  { field: "accessories", label: "配件（搭配）" },
  { field: "packaging", label: "包装改进" },
  { field: "manual", label: "说明书" },
  { field: "imageCopySuggestion", label: "文案/主图附图建议" },
  { field: "certification", label: "备注" },
];
export const scalarImprovementFields: Array<Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">> = [
  "audience",
  "scenario",
  "painPoint1",
  "painPoint2",
  "painPoint3",
  "material",
  "size",
  "functionImprovement",
  "appearance",
  "accessories",
  "packaging",
  "manual",
  "imageCopySuggestion",
  "peakSales",
  "offSeasonSales",
  "targetSales",
  "infringement",
  "certification",
];
export const peakSeasonMonths = Array.from({ length: 12 }, (_, index) => index + 1);
export const peakSeasonWeightLevels = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

export function createDefaultPeakSeasonWeights() {
  return Array.from({ length: 12 }, () => 10);
}

export function normalizePeakSeasonWeights(value: unknown) {
  if (Array.isArray(value)) {
    return normalizePeakSeasonWeightList(value);
  }

  if (typeof value === "string") {
    const parts = value
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part));

    if (parts.length === 12) {
      return normalizePeakSeasonWeightList(parts);
    }
  }

  return createDefaultPeakSeasonWeights();
}

export function getPeakSeasonWeightMultiplier(weight: number) {
  return Math.max(0, weight) / 20;
}

function normalizePeakSeasonWeightList(values: number[]) {
  const next = values.slice(0, 12).map((value) => {
    const rounded = Math.round(Number(value) || 0);
    if (rounded >= 10) {
      return Math.max(10, Math.min(100, rounded - (rounded % 10 || 0)));
    }

    if (rounded <= 5) {
      return Math.max(10, Math.min(100, rounded * 20));
    }

    return 10;
  });

  while (next.length < 12) {
    next.push(10);
  }

  return next;
}
