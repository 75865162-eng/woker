import type { ProductImageAsset } from "@/lib/products/types";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";

export function getProductListImage(product: { imageAssets?: ProductImageAsset[]; image?: string }) {
  const image = product.imageAssets?.[0]?.thumbUrl?.trim() || product.image?.trim();

  return image || "";
}

export function getProductOriginalImage(product: { imageAssets?: ProductImageAsset[]; image?: string }) {
  const image = product.imageAssets?.[0]?.originalUrl?.trim() || product.imageAssets?.[0]?.thumbUrl?.trim();

  return image || product.image?.trim() || "";
}

export async function uploadProductAttachmentAsset(file: File) {
  if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
    throw new Error(productAttachmentSizeError(file.name, file.size));
  }

  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/products/file-assets/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as {
    asset?: ProductImageAsset & { downloadUrl?: string };
    error?: string;
  };

  if (!response.ok || !data.asset?.id) {
    throw new Error(data.error || "商品附件上传失败。");
  }

  return data.asset;
}

export async function uploadProductImageAsset(file: File) {
  return uploadProductAttachmentAsset(file);
}

export async function uploadDataUrlAsProductAttachment(value: string, fileName: string) {
  if (!value.startsWith("data:")) {
    return undefined;
  }

  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) {
    throw new Error(`${fileName} 图片数据格式无效，请重新上传。`);
  }

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const body = match[3] || "";
  const bytes = isBase64
    ? Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(body));
  if (bytes.byteLength > PRODUCT_ATTACHMENT_MAX_BYTES) {
    throw new Error(productAttachmentSizeError(fileName, bytes.byteLength));
  }

  return uploadProductAttachmentAsset(new File([bytes], fileName, { type: mimeType }));
}
