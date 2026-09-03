import type { ProductImageAsset } from "@/lib/products/types";

export function getProductListImage(product: { imageAssets?: ProductImageAsset[] }) {
  const image = product.imageAssets?.[0]?.thumbUrl?.trim();

  return image || "";
}

export function getProductOriginalImage(product: { imageAssets?: ProductImageAsset[] }) {
  const image = product.imageAssets?.[0]?.originalUrl?.trim() || product.imageAssets?.[0]?.thumbUrl?.trim();

  return image || "";
}

export async function uploadProductImageAsset(file: File) {
  if (file.type.startsWith("image/") && file.type !== "image/gif") {
    return await compressImageToDataUrl(file);
  }

  return await fileToDataUrl(file);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(file: File) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return await fileToDataUrl(file);
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1400;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    return await fileToDataUrl(file);
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
  if (!blob) {
    return await fileToDataUrl(file);
  }

  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}
