"use client";

import { ImagePlus, LoaderCircle, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getProductListImage } from "@/lib/products/image-assets";
import type { ProductImageAsset } from "@/lib/products/types";

export type ProductImageUploadProgress = {
  id: string;
  name: string;
  progress: number;
};

export function ProductEditorImagePanel({
  imageAssets,
  uploadingFiles = [],
  onPreview,
  onUpload,
  onRemove,
}: {
  imageAssets?: ProductImageAsset[];
  uploadingFiles?: ProductImageUploadProgress[];
  onPreview: (asset: ProductImageAsset) => void;
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  const primaryImageAsset = imageAssets?.[0];
  const primaryImage = primaryImageAsset ? getProductListImage({ imageAssets: [primaryImageAsset] }) : "";

  return (
    <div>
      <h3 className="text-lg font-bold text-foreground">图片</h3>
      {primaryImageAsset ? (
        <button
          type="button"
          className="mt-4 flex aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-muted transition-colors hover:border-brand hover:bg-white"
          onClick={() => onPreview(primaryImageAsset)}
          title="点击查看大图"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={primaryImage} alt="商品主图预览" className="h-full w-full object-contain p-2" />
        </button>
      ) : (
        <label className="mt-4 flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white">
          <ImagePlus className="h-8 w-8 text-brand" />
          <span className="mt-2 text-sm font-semibold text-foreground">上传图片</span>
          <span className="mt-1 text-xs text-muted">可上传 5-10 张，第一张会显示为主图。</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploadingFiles.length > 0}
            onChange={(event) => {
              onUpload(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <label className={`flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white ${uploadingFiles.length ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <div className="flex flex-col items-center justify-center">
            <ImagePlus className="h-4 w-4 text-brand" />
            <span className="mt-1 text-[10px] font-semibold text-foreground">上传</span>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploadingFiles.length > 0}
            onChange={(event) => {
              onUpload(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {uploadingFiles.map((upload) => (
            <ProductImageUploadProgressCard key={upload.id} upload={upload} />
          ))}
          {imageAssets?.map((asset, index) => {
            const image = getProductListImage({ imageAssets: [asset] });
            return (
              <div key={`${asset.id || image.slice(0, 24)}-${index}`} className="flex w-[104px] items-center gap-1">
                <button
                  type="button"
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
                  onClick={() => onPreview(asset)}
                  title="点击查看大图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt={`商品图片 ${index + 1}`} className="h-full w-full object-contain p-1" />
                </button>
                <Button type="button" variant="secondary" size="icon" className="h-8 w-8 shrink-0" title="删除图片" onClick={() => onRemove(index)}>
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProductImageUploadProgressCard({ upload }: { upload: ProductImageUploadProgress }) {
  const progress = Math.round(Math.max(0, Math.min(1, upload.progress)) * 100);

  return (
    <div className="flex min-h-16 w-[180px] min-w-0 flex-1 items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-2 py-1.5">
      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-foreground" title={upload.name}>{upload.name}</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${upload.name} 上传进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1 text-[10px] font-semibold tabular-nums text-muted">{progress}%</p>
      </div>
    </div>
  );
}

export function ProductImagePreviewModal({
  image,
  loading,
  onClose,
  onLoad,
}: {
  image: string;
  loading: boolean;
  onClose: () => void;
  onLoad: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">图片预览</h3>
            <p className="mt-1 text-xs font-semibold text-muted">点击空白处或关闭按钮返回。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto p-5" onClick={onClose}>
          {loading ? <p className="text-sm font-semibold text-white">正在下载</p> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="商品图片大图"
            className={`max-h-[78vh] max-w-full object-contain ${loading ? "hidden" : ""}`}
            onLoad={onLoad}
            onError={onLoad}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}
