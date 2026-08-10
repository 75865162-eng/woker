import type { Product } from "@/lib/products/types";

export function getProductListImage(product: Product) {
  const imageAssets = product.sourceWorkbook?.imageAssets ?? [];
  const images = Array.isArray(product.images) ? product.images : [];

  for (let index = imageAssets.length - 1; index >= 0; index -= 1) {
    const asset = imageAssets[index];
    if (asset.status === "downloaded" && asset.assetUrl) {
      return asset.assetUrl;
    }
  }

  return images.find((image) => image.trim()) ?? "";
}
