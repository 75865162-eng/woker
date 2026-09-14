import type { ProductImageAsset } from "@/lib/products/types";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";

export function safeProductImageUrl(value?: string) {
  const normalized = value?.trim() ?? "";
  return normalized && !normalized.startsWith("data:") ? normalized : "";
}

export function isPlaceholderProductImageAssetId(value?: string) {
  return Boolean(value?.trim().startsWith("product-image-"));
}

function productImageFileDownloadUrl(fileId?: string) {
  const normalized = fileId?.trim();
  return normalized && !isPlaceholderProductImageAssetId(normalized)
    ? `/api/products/file-assets/${encodeURIComponent(normalized)}/download`
    : "";
}

function attachmentExtensionForMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/avif":
      return ".avif";
    case "image/gif":
      return ".gif";
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    case "text/csv":
      return ".csv";
    default:
      return "";
  }
}

export function ensureProductAttachmentFileName(fileName: string, mimeType: string) {
  if (/\.[a-z0-9]+$/i.test(fileName)) {
    return fileName;
  }

  return `${fileName}${attachmentExtensionForMimeType(mimeType)}`;
}

export function getProductListImage(product: { imageAssets?: ProductImageAsset[]; image?: string; images?: string[] }) {
  for (const asset of product.imageAssets ?? []) {
    const image = safeProductImageUrl(asset.thumbUrl)
      || productImageFileDownloadUrl(asset.thumbFileId)
      || productImageFileDownloadUrl(asset.id)
      || safeProductImageUrl(asset.originalUrl)
      || safeProductImageUrl(asset.downloadUrl);
    if (image) {
      return image;
    }
  }

  return safeProductImageUrl(product.image)
    || (product.images ?? []).map((image) => safeProductImageUrl(image)).find(Boolean)
    || "";
}

export function getProductOriginalImage(product: { imageAssets?: ProductImageAsset[]; image?: string; images?: string[] }) {
  for (const asset of product.imageAssets ?? []) {
    const image = safeProductImageUrl(asset.originalUrl)
      || safeProductImageUrl(asset.downloadUrl)
      || productImageFileDownloadUrl(asset.id)
      || safeProductImageUrl(asset.thumbUrl)
      || productImageFileDownloadUrl(asset.thumbFileId);
    if (image) {
      return image;
    }
  }

  return safeProductImageUrl(product.image)
    || (product.images ?? []).map((image) => safeProductImageUrl(image)).find(Boolean)
    || "";
}

export function getProductAssetDownloadUrl(
  asset?: Pick<ProductImageAsset, "id" | "downloadUrl" | "originalUrl" | "previewUrl" | "thumbFileId" | "thumbUrl">,
) {
  if (!asset) {
    return "";
  }

  return safeProductImageUrl(asset.previewUrl)
    || safeProductImageUrl(asset.originalUrl)
    || safeProductImageUrl(asset.downloadUrl)
    || productImageFileDownloadUrl(asset.id)
    || productImageFileDownloadUrl(asset.thumbFileId)
    || safeProductImageUrl(asset.thumbUrl)
    || "";
}

export type ProductUploadOptions = {
  onUploadProgress?: (progress: number) => void;
};

export function appendCurrentWorkspaceScope(formData: FormData) {
  if (typeof window === "undefined") {
    return formData;
  }

  try {
    const stored = window.localStorage.getItem("amazon_bulk_ad_workspace_scope");
    const scope = stored
      ? (JSON.parse(stored) as Partial<Record<"workspaceId" | "accountId" | "marketplace", unknown>>)
      : {};

    for (const field of ["workspaceId", "accountId", "marketplace"] as const) {
      const value = typeof scope[field] === "string" ? scope[field].trim() : "";
      if (value && !formData.has(field)) {
        formData.append(field, value);
      }
    }
  } catch {
    // Keep upload usable when local workspace state is unavailable or malformed.
  }

  return formData;
}

export async function uploadProductAttachmentAsset(file: File, options?: ProductUploadOptions) {
  if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
    throw new Error(productAttachmentSizeError(file.name, file.size));
  }

  const formData = new FormData();
  formData.append("file", file);
  const data = await uploadProductFormData("/api/products/file-assets/upload", appendCurrentWorkspaceScope(formData), options);

  if (!data.response.ok || !data.body.asset?.id) {
    throw new Error(data.body.error || "商品附件上传失败。");
  }

  return data.body.asset;
}

export async function uploadProductImageAsset(file: File, options?: ProductUploadOptions) {
  return uploadProductAttachmentAsset(file, options);
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

  return uploadProductAttachmentAsset(new File([bytes], ensureProductAttachmentFileName(fileName, mimeType), { type: mimeType }));
}

async function uploadProductFormData(
  url: string,
  formData: FormData,
  options?: ProductUploadOptions,
): Promise<{
  response: { ok: boolean; status: number };
  body: {
    asset?: ProductImageAsset & { downloadUrl?: string; url?: string };
    error?: string;
  };
}> {
  if (typeof XMLHttpRequest === "undefined") {
    const response = await fetch(url, { method: "POST", body: formData });
    const body = (await response.json().catch(() => ({}))) as {
      asset?: ProductImageAsset & { downloadUrl?: string; url?: string };
      error?: string;
    };
    return { response: { ok: response.ok, status: response.status }, body };
  }

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options?.onUploadProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)));
      }
    };
    xhr.onload = () => {
      let body: {
        asset?: ProductImageAsset & { downloadUrl?: string; url?: string };
        error?: string;
      } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // The caller turns an empty or invalid response into its standard upload error.
      }
      resolve({
        response: { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status },
        body,
      });
    };
    xhr.onerror = () => reject(new Error("商品附件上传失败。"));
    xhr.onabort = () => reject(new Error("商品附件上传已取消。"));
    xhr.send(formData);
  });
}
