"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Product, ProductImageAsset } from "@/lib/products/types";
import { appendCurrentWorkspaceScope, getProductAssetDownloadUrl, isPlaceholderProductImageAssetId } from "@/lib/products/image-assets";
import { getProductImageUrls } from "@/lib/products/signed-image-urls";
import { PRODUCT_ATTACHMENT_MAX_BYTES, productAttachmentSizeError } from "@/lib/products/file-assets";
import type { ProductEditorDraft } from "./product-workbench-model";

export function useProductAttachmentActions(setDraft: Dispatch<SetStateAction<ProductEditorDraft>>, setError: (message: string) => void) {
  const [conclusionUploading, setConclusionUploading] = useState(false);
  const conclusionInputRef = useRef<HTMLInputElement | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  async function openImagePreview(asset?: ProductImageAsset, fallbackImage?: string) {
    const fileId = asset?.previewFileId || asset?.id;
    let source = "";
    if (fileId && !isPlaceholderProductImageAssetId(fileId)) {
      try { source = (await getProductImageUrls([fileId])).get(fileId) || ""; }
      catch { /* 无 FileObject 的历史附件仍沿现有下载路径读取。 */ }
    }
    source ||= getProductAssetDownloadUrl(asset) || (fallbackImage?.startsWith("data:") ? "" : fallbackImage || "");
    if (!source) return;
    setPreviewLoading(true);
    setPreviewImage(source);
  }
  async function handleConclusionUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > PRODUCT_ATTACHMENT_MAX_BYTES) { setError(productAttachmentSizeError(file.name, file.size)); return; }
    setConclusionUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      appendCurrentWorkspaceScope(formData);
      const response = await fetch("/api/products/conclusion-files/upload", { method: "POST", body: formData });
      const data = await response.json() as { file?: Product["conclusionExcelFile"]; error?: string };
      if (!response.ok || !data.file) throw new Error(data.error || "结论 Excel 上传失败。");
      setDraft(current => ({ ...current, conclusionExcelFile: data.file }));
    } catch (error) { setError(error instanceof Error ? error.message : "结论 Excel 上传失败。"); }
    finally { setConclusionUploading(false); }
  }
  return { conclusionUploading, conclusionInputRef, handleConclusionUpload, previewImage, setPreviewImage, previewLoading, setPreviewLoading, openImagePreview };
}
