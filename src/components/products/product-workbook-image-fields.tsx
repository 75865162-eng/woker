"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImagePlus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProductAttachmentActivity } from "./product-attachment-activity";
import { getProductAssetDownloadUrl, isPlaceholderProductImageAssetId, uploadProductAttachmentAsset } from "@/lib/products/image-assets";
import { getProductImageUrls, useProductImageUrls } from "@/lib/products/signed-image-urls";
import type { ProductImageAsset } from "@/lib/products/types";
import { ProductImageUploadProgressCard, type ProductImageUploadProgress } from "./product-editor-image-panel";

export function isPdfDataUrl(value: string) {
  return value.startsWith("data:application/pdf");
}

export function ImageUploadSquare({
  image,
  asset,
  previewImage,
  onChange,
  onAssetChange,
  allowPdf = false,
}: {
  image: string;
  asset?: ProductImageAsset;
  previewImage?: string;
  onChange: (value: string) => void;
  onAssetChange?: (asset: ProductImageAsset) => void;
  allowPdf?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  useProductAttachmentActivity(isUploading);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const thumbFileId = asset && !isPlaceholderProductImageAssetId(asset.thumbFileId || asset.id)
    ? asset.thumbFileId || asset.id
    : undefined;
  const { urls: signedImageUrls, refresh: refreshSignedImageUrls } = useProductImageUrls([thumbFileId]);
  const [retriedSignedImage, setRetriedSignedImage] = useState(false);
  const imageSources = Array.from(new Set([
    thumbFileId ? signedImageUrls[thumbFileId] : undefined,
    ...(thumbFileId ? [] : [previewImage, image, asset?.thumbUrl, asset?.downloadUrl]),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
  const [failedImageSources, setFailedImageSources] = useState<string[]>([]);
  const displayedImageSource = imageSources.find((source) => !failedImageSources.includes(source)) ?? "";

  useEffect(() => {
    setFailedImageSources([]);
    setRetriedSignedImage(false);
  }, [image, previewImage, asset?.id, asset?.thumbUrl, asset?.downloadUrl]);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError("");

    try {
      const asset = await uploadProductAttachmentAsset(file, { onUploadProgress: setUploadProgress });
      onChange(asset.thumbUrl || asset.originalUrl);
      onAssetChange?.(asset);
      setPreviewOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  async function openPreview() {
    const fileId = asset && !isPlaceholderProductImageAssetId(asset.previewFileId || asset.id)
      ? asset.previewFileId || asset.id
      : undefined;
    let source = "";
    if (fileId) {
      try {
        source = (await getProductImageUrls([fileId])).get(fileId) || "";
      } catch {
        // Legacy references continue through the compatibility route below.
      }
    }
    source ||= getProductAssetDownloadUrl(asset) || (image.startsWith("data:") ? "" : previewImage || image);
    if (!source) {
      return;
    }
    setPreviewSource(source);
    setPreviewLoading(true);
    setPreviewOpen(true);
  }

  const hasUploadedAsset = Boolean(asset?.id && !isPlaceholderProductImageAssetId(asset.id));
  const hasFile = Boolean(image || hasUploadedAsset);
  const isPdf = asset?.mimeType === "application/pdf" || isPdfDataUrl(image) || image.toLowerCase().endsWith(".pdf");

  return (
    <>
      {hasFile ? (
        <button
          type="button"
          className="flex h-[130px] w-[130px] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
          onClick={() => void openPreview()}
          title="查看大图"
        >
          {isPdf ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md bg-surface text-center">
              <FileText className="h-10 w-10 text-brand" />
              <span className="max-w-[112px] truncate px-2 text-xs font-semibold text-foreground">{asset?.name || "PDF"}</span>
            </div>
          ) : (
            displayedImageSource ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayedImageSource}
                alt="竞品图片"
                className="h-full w-full object-contain p-1"
                onError={() => {
                  if (thumbFileId && !retriedSignedImage) {
                    setRetriedSignedImage(true);
                    void refreshSignedImageUrls([thumbFileId]).catch(() => undefined);
                  } else {
                    setFailedImageSources((current) => current.includes(displayedImageSource)
                      ? current
                      : [...current, displayedImageSource]);
                  }
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted">图片加载失败</div>
            )
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            className="flex h-[130px] w-[130px] items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center text-xs font-semibold text-muted transition-colors hover:border-brand hover:bg-surface"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "上传中" : "上传图片"}
          </button>
          {isUploading ? <UploadProgressBar progress={uploadProgress} /> : null}
        </div>
      )}
      {uploadError ? <p className="text-label font-semibold text-danger">{uploadError}</p> : null}
      <input ref={fileInputRef} type="file" accept={allowPdf ? "image/*,.pdf" : "image/*"} className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />

      {previewOpen && (image || asset?.id) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/70 p-6" onClick={() => setPreviewOpen(false)} role="dialog" aria-modal="true">
          <div className="relative flex max-h-full max-w-5xl items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <div className="absolute right-0 top-0 z-10 flex translate-y-[-120%] gap-2">
              <Button variant="secondary" size="sm" disabled={isUploading} onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>
                <ImagePlus className="h-4 w-4" />
                {isUploading ? "上传中" : allowPdf ? "替换文件" : "替换图片"}
              </Button>
              <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); setPreviewOpen(false); }}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            <div className="flex items-center justify-center" onClick={() => setPreviewOpen(false)}>
              {isPdf ? (
                <>
                  {previewLoading ? <p className="absolute text-sm font-semibold text-white">正在下载</p> : null}
                  <object data={previewSource} type="application/pdf" className={`h-[82vh] w-[88vw] rounded-lg bg-surface shadow-2xl ${previewLoading ? "opacity-0" : ""}`} onLoad={() => setPreviewLoading(false)} onClick={(event) => event.stopPropagation()}>
                    <p className="rounded-lg bg-surface px-4 py-3 text-sm text-muted">PDF 预览不可用。</p>
                  </object>
                </>
              ) : (
                <>
                  {previewLoading ? <p className="absolute text-sm font-semibold text-white">正在下载</p> : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewSource} alt="竞品大图" className={`max-h-[82vh] max-w-[88vw] rounded-lg bg-surface object-contain shadow-2xl ${previewLoading ? "opacity-0" : ""}`} onLoad={() => setPreviewLoading(false)} onError={() => setPreviewLoading(false)} onClick={(event) => event.stopPropagation()} />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function RemarkImagesUploader({
  images,
  imageAssets,
  onChange,
}: {
  images: string[];
  imageAssets?: ProductImageAsset[];
  onChange: (images: string[], imageAssets?: ProductImageAsset[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  useProductAttachmentActivity(isUploading);
  const [uploadError, setUploadError] = useState("");
  const [uploadingFiles, setUploadingFiles] = useState<ProductImageUploadProgress[]>([]);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) {
      return;
    }

    setIsUploading(true);
    const uploads = selected.map((file, index) => ({
      id: `remark-image-upload-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    setUploadingFiles(uploads.map(({ id, file }) => ({ id, name: file.name, progress: 0 })));
    setUploadError("");

    try {
      const results = await Promise.allSettled(
        uploads.map(({ id, file }) =>
          uploadProductAttachmentAsset(file, {
            onUploadProgress: (progress) => {
              setUploadingFiles((current) => current.map((item) => (item.id === id ? { ...item, progress } : item)));
            },
          }),
        ),
      );
      const nextAssets = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const firstError = results.find((result) => result.status === "rejected");

      if (nextAssets.length) {
        onChange(
          [...images, ...nextAssets.map((asset) => asset.thumbUrl || asset.originalUrl)],
          [...(imageAssets ?? []), ...nextAssets],
        );
      }

      if (firstError && firstError.status === "rejected") {
        setUploadError(firstError.reason instanceof Error ? firstError.reason.message : "图片上传失败。");
      }
    } finally {
      setIsUploading(false);
      setUploadingFiles([]);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-muted">备注图片</p>
        <Button variant="secondary" size="sm" disabled={isUploading} onClick={() => inputRef.current?.click()}>
          {isUploading ? <Save className="h-4 w-4 animate-pulse" /> : <ImagePlus className="h-4 w-4" />}
          {isUploading ? "上传中" : "批量上传图片 / PDF"}
        </Button>
      </div>
      {uploadError ? <p className="mt-2 text-xs font-semibold text-danger">{uploadError}</p> : null}
      {uploadingFiles.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {uploadingFiles.map((upload) => (
            <ProductImageUploadProgressCard key={upload.id} upload={upload} />
          ))}
        </div>
      ) : null}
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="image/*,.pdf"
        multiple
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {images.map((image, index) => (
            <div key={`${image.slice(0, 32)}-${index}`} className="space-y-2">
              <ImageUploadSquare
                image={imageAssets?.[index]?.thumbUrl || image}
                asset={imageAssets?.[index]}
                previewImage={imageAssets?.[index]?.previewUrl || imageAssets?.[index]?.originalUrl || imageAssets?.[index]?.thumbUrl || image}
                allowPdf
                onChange={(value) =>
                  onChange(
                    images.map((item, itemIndex) => (itemIndex === index ? value : item)),
                    imageAssets,
                  )
                }
                onAssetChange={(asset) =>
                  onChange(
                    images,
                    imageAssets?.map((currentAsset, assetIndex) => (assetIndex === index ? asset : currentAsset)),
                  )
                }
              />
              <Button variant="secondary" size="sm" className="w-[130px]" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index), imageAssets?.filter((_, itemIndex) => itemIndex !== index))}>
                删除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-border bg-surface px-3 py-6 text-center text-xs font-semibold text-muted">
          导入 Excel 中非热销变体图片，或手动批量上传图片 / PDF 后会显示在这里。
        </div>
      )}
    </div>
  );
}

export function UploadProgressBar({ progress }: { progress: number }) {
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div className="w-[130px]">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="文件上传进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${percentage}%` }} />
      </div>
      <p className="mt-1 text-center text-label font-semibold tabular-nums text-muted">{percentage}%</p>
    </div>
  );
}
