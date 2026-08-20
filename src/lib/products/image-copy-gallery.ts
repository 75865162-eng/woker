import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";

export type ProductGalleryInfo = {
  asin: string;
  productFeatures: string;
  sales: string;
  price: string;
  variation: string;
  rating: string;
  reviewCount: string;
  title: string;
  bullets: string;
  aplus: string;
};

export type ProductGalleryColumn = {
  label: string;
  info: ProductGalleryInfo;
  images: ImagePreview[];
};

export type ProductImageCopyGalleryDraft = {
  structureNotes: string;
  imageNotes: string[];
  competitorColumns: ProductGalleryColumn[];
  mineInfo: ProductGalleryInfo;
  mineImages: ImagePreview[];
};

export const productGalleryInfoRows: Array<{
  label: string;
  mineKey: keyof ProductGalleryInfo;
  competitorKey: keyof ProductGalleryInfo;
  asin?: boolean;
  multiline?: boolean;
  tall?: boolean;
}> = [
  { label: "ASIN", mineKey: "asin", competitorKey: "asin", asin: true },
  { label: "产品卖点", mineKey: "productFeatures", competitorKey: "productFeatures", multiline: true },
  { label: "销量", mineKey: "sales", competitorKey: "sales" },
  { label: "价格", mineKey: "price", competitorKey: "price" },
  { label: "变体", mineKey: "variation", competitorKey: "variation" },
  { label: "星级", mineKey: "rating", competitorKey: "rating" },
  { label: "评论数", mineKey: "reviewCount", competitorKey: "reviewCount" },
  { label: "标题", mineKey: "title", competitorKey: "title", multiline: true },
  { label: "5点1", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
  { label: "5点2", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
  { label: "5点3", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
  { label: "5点4", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
  { label: "5点5", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
  { label: "5点6", mineKey: "bullets", competitorKey: "bullets", multiline: true, tall: true },
];

export const productGalleryAplusRow = {
  label: "A+",
  mineKey: "aplus" as const,
  competitorKey: "aplus" as const,
  multiline: true,
};

function createEmptyGalleryInfo(): ProductGalleryInfo {
  return {
    asin: "",
    productFeatures: "",
    sales: "",
    price: "",
    variation: "",
    rating: "",
    reviewCount: "",
    title: "",
    bullets: "",
    aplus: "",
  };
}

function normalizeGalleryInfo(info: Partial<ProductGalleryInfo> | null | undefined) {
  return {
    ...createEmptyGalleryInfo(),
    ...info,
  };
}

export function createEmptyProductImageCopyGallery(
  competitorCount = 3,
): ProductImageCopyGalleryDraft {
  return {
    structureNotes: "",
    imageNotes: [],
    competitorColumns: Array.from({ length: competitorCount }, (_, index) => ({
      label: `Competitor ${index + 1}`,
      info: createEmptyGalleryInfo(),
      images: [],
    })),
    mineInfo: createEmptyGalleryInfo(),
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
            info: normalizeGalleryInfo(
              (column as Partial<ProductGalleryColumn> | undefined)?.info,
            ),
            images: Array.isArray(column.images) ? column.images : [],
          }))
        : fallback.competitorColumns,
    mineInfo: normalizeGalleryInfo(
      (draft as Partial<ProductImageCopyGalleryDraft> | null | undefined)?.mineInfo,
    ),
    mineImages: Array.isArray(draft?.mineImages)
      ? draft.mineImages
      : fallback.mineImages,
  };
}

function stripLocalImages(images: ImagePreview[] | undefined) {
  return Array.isArray(images)
    ? images
        .filter(
          (image) =>
            image.assetId ||
            (image.url &&
              !image.url.startsWith("data:image/") &&
              !image.url.startsWith("blob:")),
        )
        .map((image) => (image.assetId ? { ...image, url: "" } : image))
    : [];
}

function resolveImagePreviewUrl(image: ImagePreview) {
  const url = image.url?.trim() || "";

  if (url && !url.startsWith("data:") && !url.startsWith("blob:")) {
    return url;
  }

  if (image.assetId) {
    return `/api/assets/${image.assetId.split("/").map(encodeURIComponent).join("/")}`;
  }

  return url;
}

export function getProductImageCopyGalleryMineImageUrls(
  draft: Partial<ProductImageCopyGalleryDraft> | null | undefined,
) {
  return Array.isArray(draft?.mineImages)
    ? draft.mineImages.map(resolveImagePreviewUrl).map((url) => url.trim()).filter(Boolean)
    : [];
}

export function createPersistableProductImageCopyGallery(
  draft: ProductImageCopyGalleryDraft,
): ProductImageCopyGalleryDraft {
  return {
    ...draft,
    competitorColumns: draft.competitorColumns.map((column) => ({
      ...column,
      images: stripLocalImages(column.images),
    })),
    mineImages: stripLocalImages(draft.mineImages),
  };
}
