import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";

export type ProductGalleryColumn = {
  label: string;
  images: ImagePreview[];
};

export type ProductImageCopyGalleryDraft = {
  structureNotes: string;
  imageNotes: string[];
  competitorColumns: ProductGalleryColumn[];
  mineImages: ImagePreview[];
};

export const productImageCopyGalleryStoragePrefix =
  "amazon-bulk-ad-product-image-copy-gallery-v1";

export function getProductImageCopyGalleryStorageKey(sku: string) {
  return `${productImageCopyGalleryStoragePrefix}:${sku.trim().toUpperCase()}`;
}

export function createEmptyProductImageCopyGallery(
  competitorCount = 3,
): ProductImageCopyGalleryDraft {
  return {
    structureNotes: "",
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
