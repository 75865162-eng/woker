import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";

export type ProductGalleryColumn = {
  label: string;
  images: ImagePreview[];
};

export type ProductImageCopyGalleryDraft = {
  structureNotes: string;
  asin: string;
  productFeatures: string;
  sales: string;
  price: string;
  variation: string;
  rating: string;
  reviewCount: string;
  title: string;
  bullets: string[];
  aplusRequirements: string;
  imageNotes: string[];
  competitorColumns: ProductGalleryColumn[];
  mineImages: ImagePreview[];
};

export function createEmptyProductImageCopyGallery(
  competitorCount = 3,
): ProductImageCopyGalleryDraft {
  return {
    structureNotes: "",
    asin: "",
    productFeatures: "",
    sales: "",
    price: "",
    variation: "",
    rating: "",
    reviewCount: "",
    title: "",
    bullets: Array.from({ length: 6 }, () => ""),
    aplusRequirements: "",
    imageNotes: [],
    competitorColumns: Array.from({ length: competitorCount }, (_, index) => ({
      label: `Competitor ${index + 1}`,
      images: [],
    })),
    mineImages: [],
  };
}

export function normalizeProductImageCopyGallery(
  draft: Partial<ProductImageCopyGalleryDraft> | null | undefined,
  competitorCount = 3,
): ProductImageCopyGalleryDraft {
  const fallback = createEmptyProductImageCopyGallery(competitorCount);

  return {
    structureNotes: draft?.structureNotes ?? fallback.structureNotes,
    asin: draft?.asin ?? fallback.asin,
    productFeatures: draft?.productFeatures ?? fallback.productFeatures,
    sales: draft?.sales ?? fallback.sales,
    price: draft?.price ?? fallback.price,
    variation: draft?.variation ?? fallback.variation,
    rating: draft?.rating ?? fallback.rating,
    reviewCount: draft?.reviewCount ?? fallback.reviewCount,
    title: draft?.title ?? fallback.title,
    bullets: normalizeBulletLines(draft?.bullets, fallback.bullets),
    aplusRequirements: draft?.aplusRequirements ?? fallback.aplusRequirements,
    imageNotes: Array.isArray(draft?.imageNotes)
      ? draft.imageNotes
      : fallback.imageNotes,
    competitorColumns:
      Array.isArray(draft?.competitorColumns) &&
      draft.competitorColumns.length
        ? draft.competitorColumns.map((column, index) => ({
            label: column.label || `Competitor ${index + 1}`,
            images: Array.isArray(column.images) ? column.images : [],
          }))
        : fallback.competitorColumns,
    mineImages: Array.isArray(draft?.mineImages)
      ? draft.mineImages
      : fallback.mineImages,
  };
}

function normalizeBulletLines(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return Array.from({ length: 6 }, (_, index) => String(value[index] ?? "").trim());
  }

  if (typeof value === "string") {
    const lines = value.split(/\r?\n/u).map((line) => line.trim());
    return Array.from({ length: 6 }, (_, index) => lines[index] ?? "");
  }

  return fallback;
}
