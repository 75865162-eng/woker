import type { Product } from "@/lib/products/types";
import { addWorkspaceScopeToFormData, scopedFetch } from "@/lib/workspace/scoped-fetch";

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

export async function uploadProductImageAsset(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  addWorkspaceScopeToFormData(formData);

  const response = await scopedFetch("/api/assets/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as {
    asset?: { url: string };
    error?: string;
  };

  if (!response.ok || !data.asset?.url) {
    throw new Error(data.error ?? "图片上传失败。");
  }

  return data.asset.url;
}
