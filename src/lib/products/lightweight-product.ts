import type { Product } from "@/lib/products/types";
import { getProductListImage, isPlaceholderProductImageAssetId } from "@/lib/products/image-assets";

function isDataUrl(value: string) {
  return /^data:[^,]+,/i.test(value.trim());
}

function isAsset(value: Record<string, unknown>) {
  return typeof value.id === "string" && typeof value.mimeType === "string" && (
    "originalUrl" in value || "thumbUrl" in value || "downloadUrl" in value
  );
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "fileDataUrl" || key === "originalUrl" || isDataUrl(value)) {
      return "";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(source)) {
    if (childKey === "fileDataUrl") {
      continue;
    }
    result[childKey] = sanitizeValue(childValue, childKey);
  }

  if (isAsset(source)) {
    result.originalUrl = "";
    const mimeType = typeof source.mimeType === "string" ? source.mimeType : "";
    if (!mimeType.startsWith("image/")) {
      result.thumbUrl = "";
    } else if (
      typeof result.thumbUrl !== "string"
      || !result.thumbUrl.trim()
      || isDataUrl(result.thumbUrl)
    ) {
      const originalUrl = typeof source.originalUrl === "string" ? source.originalUrl.trim() : "";
      result.thumbUrl = !isDataUrl(originalUrl)
        ? originalUrl
        : typeof source.thumbFileId === "string" && source.thumbFileId && !isPlaceholderProductImageAssetId(source.thumbFileId)
          ? `/api/products/file-assets/${encodeURIComponent(source.thumbFileId)}/download`
          : typeof source.id === "string" && source.id && !isPlaceholderProductImageAssetId(source.id)
            ? `/api/products/file-assets/${encodeURIComponent(source.id)}/download`
          : "";
    }
  }

  return result;
}

export function toLightweightProduct(product: Product): Product {
  const sanitized = sanitizeValue(product) as Product;
  const withExtras = sanitized as Product & {
    workbookDetail?: {
      remarkImages?: string[];
      remarkImageAssets?: Array<{ thumbUrl?: string }>;
      competitors?: Array<{
        hotVariantImage?: string;
        hotVariantImageAsset?: { thumbUrl?: string };
        noteImage?: string;
        noteImageAsset?: { thumbUrl?: string };
      }>;
    };
  };

  sanitized.image = getProductListImage(sanitized);
  sanitized.images = (sanitized.imageAssets ?? []).length
    ? (sanitized.imageAssets ?? []).map((asset) => asset.thumbUrl).filter(Boolean)
    : (sanitized.images ?? []).filter((image) => Boolean(image) && !isDataUrl(image));

  if (withExtras.workbookDetail) {
    withExtras.workbookDetail.remarkImages = (withExtras.workbookDetail.remarkImageAssets ?? [])
      .map((asset) => asset.thumbUrl || "");
    withExtras.workbookDetail.competitors = (withExtras.workbookDetail.competitors ?? []).map((competitor) => ({
      ...competitor,
      hotVariantImage: competitor.hotVariantImageAsset?.thumbUrl || "",
      noteImage: competitor.noteImageAsset?.thumbUrl || "",
    }));
  }

  return sanitized;
}
