import type { Product, ProductImageAsset } from "@/lib/products/types";
import { uploadDataUrlAsProductAttachment } from "@/lib/products/image-assets";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";
import type { TrialProductDraft } from "./product-workbench-model";

export function selectProductImageFiles(files: Iterable<File>, currentImageCount: number, maxImages = 10) {
  const remaining = Math.max(0, maxImages - Math.max(0, currentImageCount));
  return Array.from(files).slice(0, remaining);
}

export async function uploadProductImageFile(file: File): Promise<ProductImageAsset> {
  if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) {
    throw new Error(productAttachmentSizeError(file.name, file.size));
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("商品主图仅支持图片文件。");
  }
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/products/image-assets/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as {
    asset?: ProductImageAsset & { url?: string };
    error?: string;
  };
  if (!response.ok || !data.asset?.id) {
    throw new Error(data.error || "商品图片上传失败。");
  }
  return {
    ...data.asset,
    thumbUrl: data.asset.thumbUrl || data.asset.url || data.asset.originalUrl,
  };
}

export async function uploadEmbeddedProductImages(product: Product) {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  const sourceImages = Array.isArray(product.images) ? product.images.filter((image) => image.trim()) : [];
  const uploadedImages = await Promise.all(sourceImages.map((image, index) => uploadDataUrlImage(image, `${product.sku || "product"}-${index + 1}.png`)));
  const sourceRemarkImages = Array.isArray(productWithWorkbook.workbookDetail?.remarkImages)
    ? productWithWorkbook.workbookDetail.remarkImages.filter((image) => image.trim())
    : [];
  const uploadedRemarkImages = await Promise.all(sourceRemarkImages.map((image, index) => uploadDataUrlImage(image, `${product.sku || "product"}-remark-${index + 1}.png`)));
  const workbookDetail = productWithWorkbook.workbookDetail
    ? {
        ...productWithWorkbook.workbookDetail,
        remarkImages: uploadedRemarkImages.map((asset) => asset.thumbUrl),
        remarkImageAssets: uploadedRemarkImages,
        competitors: await Promise.all(
          (Array.isArray(productWithWorkbook.workbookDetail.competitors) ? productWithWorkbook.workbookDetail.competitors : []).map(async (competitor, index) => {
            const hotVariantImageAsset = competitor.hotVariantImage.trim()
              ? await uploadDataUrlImage(competitor.hotVariantImage, `${product.sku || "product"}-competitor-${index + 1}.png`)
              : undefined;
            const noteImageAsset = competitor.noteImage.trim()
              ? await uploadDataUrlImage(competitor.noteImage, `${product.sku || "product"}-competitor-note-${index + 1}.png`)
              : undefined;

            return {
              ...competitor,
              hotVariantImageAsset,
              hotVariantImage: hotVariantImageAsset?.thumbUrl || "",
              noteImageAsset,
              noteImage: noteImageAsset?.thumbUrl || "",
            };
          }),
        ),
      }
    : undefined;

  return {
    ...product,
    images: [],
    imageAssets: uploadedImages,
    ...(workbookDetail ? { workbookDetail } : {}),
  };
}

async function uploadDataUrlImage(value: string, name: string) {
  if (!value.startsWith("data:")) {
    return {
      id: "",
      name,
      mimeType: "",
      size: 0,
      storageType: "r2",
      uploadedAt: "",
      thumbUrl: value,
      originalUrl: value,
    } satisfies ProductImageAsset;
  }

  const asset = await uploadDataUrlAsProductAttachment(value, name);
  if (!asset) {
    throw new Error(`${name} 图片上传失败。`);
  }
  return asset;
}
