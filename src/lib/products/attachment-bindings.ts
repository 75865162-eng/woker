import type { Product } from "@/lib/products/types";

export type ProductAttachmentReference = {
  fileId: string;
  fieldPath: string;
};

export function collectProductAttachmentReferences(product: Product): ProductAttachmentReference[] {
  const references = new Map<string, ProductAttachmentReference>();

  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.fileId === "string" && record.fileId.trim()) {
      references.set(record.fileId, {
        fileId: record.fileId.trim(),
        fieldPath: `${path}.fileId`,
      });
    }

    if (typeof record.thumbFileId === "string" && record.thumbFileId.trim()) {
      references.set(record.thumbFileId, {
        fileId: record.thumbFileId.trim(),
        fieldPath: `${path}.thumbFileId`,
      });
    }

    const hasAssetShape =
      typeof record.id === "string"
      && record.id.trim()
      && !isPlaceholderAssetId(record.id)
      && typeof record.mimeType === "string"
      && ("url" in record || "thumbUrl" in record || "originalUrl" in record || "downloadUrl" in record);

    if (hasAssetShape) {
      references.set(record.id as string, {
        fileId: (record.id as string).trim(),
        fieldPath: `${path}.id`,
      });
    }

    Object.entries(record).forEach(([key, child]) => {
      if (key === "fileDataUrl" || key === "url" || key === "thumbUrl" || key === "originalUrl" || key === "downloadUrl") {
        return;
      }
      visit(child, path ? `${path}.${key}` : key);
    });
  }

  visit(product, "product");
  return Array.from(references.values());
}

function isPlaceholderAssetId(value: string) {
  return value.startsWith("product-image-");
}

export function hasInlineProductAttachmentData(value: unknown): boolean {
  if (typeof value === "string") {
    return value.startsWith("data:");
  }

  if (Array.isArray(value)) {
    return value.some(hasInlineProductAttachmentData);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "fileDataUrl"
    ? typeof child === "string" && child.startsWith("data:")
    : hasInlineProductAttachmentData(child));
}
