"use client";

import { parseOptionalProductNumber } from "./product-workbench-utils";
import type { ProductImageAsset } from "@/lib/products/types";
import { type ProductEditorDraft, type TrialCompetitorRow, type TrialImprovement, type TrialImprovementCellKey, type TrialKeywordRow, type TrialPriceRow, type TrialProductDraft, type TrialSupplierRow } from "./product-workbench-model";
import { createEmptyImprovementRow, getImprovementRow } from "./product-workbook-detail-sections";

export function useProductWorkbookEditing(setDraft: React.Dispatch<React.SetStateAction<ProductEditorDraft>>) {
function setWorkbookDetail(updater: (current: TrialProductDraft) => TrialProductDraft) {
    setDraft((current) => ({ ...current, workbookDetail: updater(current.workbookDetail) }));
  }

function updateWorkbookPricingRow(index: number, field: keyof TrialPriceRow, value: string | number | null) {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, [field]: field === "name" ? String(value ?? "") : parseOptionalProductNumber(value) }
          : row,
      ),
    }));
  }

function addWorkbookPricingRow() {
    setWorkbookDetail((current) => {
      const previous = current.pricingRows[current.pricingRows.length - 1];
      const nextRow: TrialPriceRow = previous
        ? { ...previous, name: "" }
        : { name: "", lengthCm: null, widthCm: null, heightCm: null, actualWeightKg: null, suggestedPrice: null, purchaseCost: null, oceanFreightUnitPrice: 12, fbaFee: null, exchangeRate: 6.9 };

      return { ...current, pricingRows: [...current.pricingRows, nextRow] };
    });
  }

function copyWorkbookPricingRow(index: number) {
    setWorkbookDetail((current) => {
      const row = current.pricingRows[index];
      if (!row) return current;

      const pricingRows = [...current.pricingRows];
      pricingRows.splice(index + 1, 0, { ...row });
      return { ...current, pricingRows };
    });
  }

function removeWorkbookPricingRow() {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.length > 1 ? current.pricingRows.slice(0, -1) : current.pricingRows,
    }));
  }

function updateWorkbookCompetitor(index: number, field: keyof TrialCompetitorRow, value: string, asset?: ProductImageAsset) {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, [field]: value };
        if (field === "type" && value !== "直接竞品") {
          return {
            ...nextRow,
            negativePoint1: "",
            negativePoint2: "",
            negativePoint3: "",
            negativePoint4: "",
            negativePoint5: "",
          };
        }

        if (field === "hotVariantImage") {
          return { ...nextRow, hotVariantImageAsset: asset };
        }

        if (field === "noteImage") {
          return { ...nextRow, noteImageAsset: asset };
        }

        return nextRow;
      }),
    }));
    if (field === "asin") {
      setDraft((current) => {
        const next = [...current.competitorAsins];
        next[index] = value.trim();
        return { ...current, competitorAsins: next };
      });
    }
  }

function addWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: [
        ...current.competitors,
        {
          type: "直接竞品",
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
          hotVariantImageAsset: undefined,
          noteImageAsset: undefined,
        },
      ],
    }));
  }

function removeWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.length > 1 ? current.competitors.slice(0, -1) : current.competitors,
    }));
  }

function updateWorkbookSupplier(index: number, field: keyof TrialSupplierRow, value: string | number | null) {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]:
                field === "cost100" || field === "cost300"
                  ? parseOptionalProductNumber(value)
                  : value,
            }
          : row,
      ),
    }));
  }

function addWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: [
        ...current.suppliers,
        {
          productUrl: "",
          factoryName: "",
          configuration: "",
          moq: "",
          leadTime: "",
          domesticFreightIncluded: "",
          certifications: "",
          patentCountry: "",
          packagingMethod: "",
          cost100: null,
          cost300: null,
          taxPoint: "",
          invoiceName: "",
          invoiceSpecUnit: "",
          invoiceRegion: "",
        },
      ],
    }));
  }

function removeWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.length > 1 ? current.suppliers.slice(0, -1) : current.suppliers,
    }));
  }

function updateWorkbookImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
    setWorkbookDetail((current) => ({ ...current, improvement: { ...current.improvement, [field]: value } }));
  }

function updateWorkbookPeakSeasonWeights(value: number[]) {
    setWorkbookDetail((current) => ({
      ...current,
      improvement: { ...current.improvement, peakSeasonWeights: value },
    }));
  }

function updateWorkbookImprovementRow(index: number, field: TrialImprovementCellKey, value: string) {
    setWorkbookDetail((current) => {
      const rows = [...(current.improvement.rows ?? [])];
      rows[index] = {
        ...createEmptyImprovementRow(),
        ...getImprovementRow(current.improvement, index),
        [field]: value,
      };

      return {
        ...current,
        improvement: {
          ...current.improvement,
          rows,
        },
      };
    });
  }

function updateWorkbookKeyword(index: number, field: keyof TrialKeywordRow, value: string | number | null) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "keyword" ? String(value) : parseOptionalProductNumber(value) } : row,
      ),
    }));
  }

function replaceWorkbookKeywords(keywords: TrialKeywordRow[]) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: keywords.length ? keywords : current.keywords,
    }));
  }

function updateWorkbookRemarkImages(images: string[], remarkImageAssets?: ProductImageAsset[]) {
    setWorkbookDetail((current) => ({
      ...current,
      remarkImages: images,
      remarkImageAssets: remarkImageAssets ?? current.remarkImageAssets,
    }));
  }
return { setWorkbookDetail, updateWorkbookPricingRow, addWorkbookPricingRow, copyWorkbookPricingRow, removeWorkbookPricingRow, updateWorkbookCompetitor, addWorkbookCompetitor, removeWorkbookCompetitor, updateWorkbookSupplier, addWorkbookSupplier, removeWorkbookSupplier, updateWorkbookImprovement, updateWorkbookPeakSeasonWeights, updateWorkbookImprovementRow, updateWorkbookKeyword, replaceWorkbookKeywords, updateWorkbookRemarkImages };
}
