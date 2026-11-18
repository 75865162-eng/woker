"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Download, ImagePlus, LoaderCircle, Minus, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { getProductListImage } from "@/lib/products/image-assets";
import { isPlaceholderProductImageAssetId } from "@/lib/products/image-assets";
import { useProductImageUrls } from "@/lib/products/signed-image-urls";
import type { ProductImageAsset } from "@/lib/products/types";

export type ProductImageUploadProgress = {
  id: string;
  name: string;
  progress: number;
  status?: "queued" | "uploading" | "failed";
  previewUrl?: string;
  error?: string;
};

export function ProductEditorImagePanel({
  imageAssets,
  uploadingFiles = [],
  onPreview,
  onUpload,
  onCancelUpload,
  onRetryUpload,
  onRemove,
}: {
  imageAssets?: ProductImageAsset[];
  uploadingFiles?: ProductImageUploadProgress[];
  onPreview: (asset: ProductImageAsset) => void;
  onUpload: (files: FileList | null) => void;
  onCancelUpload?: (id: string) => void;
  onRetryUpload?: (id: string) => void;
  onRemove: (index: number) => void;
}) {
  const primaryImageAsset = imageAssets?.[0];
  const imageFileIds = (imageAssets ?? []).map((asset) => {
    const fileId = asset.thumbFileId || asset.id;
    return isPlaceholderProductImageAssetId(fileId) ? undefined : fileId;
  });
  const imageFileIdsKey = imageFileIds.join("|");
  const { urls: signedImageUrls, refresh: refreshSignedImageUrls } = useProductImageUrls(imageFileIds);
  const [retriedFileIds, setRetriedFileIds] = useState<string[]>([]);
  useEffect(() => setRetriedFileIds([]), [imageFileIdsKey]);
  const retrySignedImage = (fileId: string) => {
    if (retriedFileIds.includes(fileId)) return;
    setRetriedFileIds((current) => [...current, fileId]);
    void refreshSignedImageUrls([fileId]).catch(() => undefined);
  };
  // 缩略图已升级为 250×250；本地资产 URL 加版本参数，让已加载过的旧 160px 缩略图立即复取。
  // 仅对 /api/assets/ 代理路径生效，不影响 S3/R2 预签名 URL 的签名。
  const bustLegacyAssetCache = (url: string) => {
    if (!url.startsWith("/api/assets/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}v=thumb250`;
  };
  const sourceForAsset = (asset: ProductImageAsset) => {
    const fileId = asset.thumbFileId || asset.id;
    return bustLegacyAssetCache(
      !isPlaceholderProductImageAssetId(fileId)
        ? signedImageUrls[fileId] || ""
        : getProductListImage({ imageAssets: [asset] }),
    );
  };
  const primaryImage = primaryImageAsset ? sourceForAsset(primaryImageAsset) : "";

  return (
    <div>
      <h3 className="text-lg font-bold text-foreground">图片</h3>
      {primaryImageAsset ? (
        <button
          type="button"
          className="mt-4 flex aspect-square w-full overflow-hidden rounded-lg border border-border bg-surface-muted transition-colors hover:border-brand hover:bg-surface"
          onClick={() => onPreview(primaryImageAsset)}
          title="点击查看大图"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={primaryImage}
            alt="商品主图预览"
            className="h-full w-full object-contain p-2"
            onError={() => {
              const fileId = primaryImageAsset.thumbFileId || primaryImageAsset.id;
              if (!isPlaceholderProductImageAssetId(fileId)) retrySignedImage(fileId);
            }}
          />
        </button>
      ) : (
        <label className="mt-4 flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-surface">
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
      <div className="mt-3 flex items-start gap-2 overflow-x-auto pb-1">
        <label className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-surface ${uploadingFiles.length ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <div className="flex flex-col items-center justify-center">
            <ImagePlus className="h-4 w-4 text-brand" />
            <span className="mt-1 text-label font-semibold text-foreground">上传</span>
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
        <div className="flex w-max shrink-0 gap-2">
          {uploadingFiles.map((upload) => (
            <ProductImageUploadProgressCard key={upload.id} upload={upload} onCancel={onCancelUpload ? () => onCancelUpload(upload.id) : undefined} onRetry={onRetryUpload ? () => onRetryUpload(upload.id) : undefined} />
          ))}
          {imageAssets?.map((asset, index) => {
            const image = sourceForAsset(asset);
            return (
              <div key={`${asset.id || image.slice(0, 24)}-${index}`} className="flex w-[104px] shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
                  onClick={() => onPreview(asset)}
                  title="点击查看大图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt={`商品图片 ${index + 1}`}
                    className="h-full w-full object-contain p-1"
                    onError={() => {
                      const fileId = asset.thumbFileId || asset.id;
                      if (!isPlaceholderProductImageAssetId(fileId)) retrySignedImage(fileId);
                    }}
                  />
                </button>
                <Button type="button" variant="secondary" size="icon" className="h-8 w-8 shrink-0" title="删除图片" disabled={uploadingFiles.length > 0} onClick={() => onRemove(index)}>
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

export function ProductImageUploadProgressCard({ upload, onCancel, onRetry }: { upload: ProductImageUploadProgress; onCancel?: () => void; onRetry?: () => void }) {
  const progress = Math.round(Math.max(0, Math.min(1, upload.progress)) * 100);
  const statusLabel = upload.status === "failed" ? "上传失败" : upload.status === "queued" ? "等待上传…" : progress >= 100 ? "处理中…" : "上传中";

  return (
    <div className={`flex min-h-16 w-[180px] shrink-0 min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 ${upload.status === "failed" ? "border-danger/30 bg-danger-soft" : "border-brand/30 bg-brand/5"}`}>
      {upload.previewUrl ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={upload.previewUrl} alt={`${upload.name} 本地预览`} className="h-12 w-12 shrink-0 rounded object-cover" />
      </> : null}
      {upload.status === "failed" ? <X className="h-4 w-4 shrink-0 text-danger-ink" /> : <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-semibold text-foreground" title={upload.name}>{upload.name}</p>
        <p className={`text-label font-medium ${upload.status === "failed" ? "text-danger-ink" : "text-muted"}`} title={upload.error}>{statusLabel}{upload.error ? `：${upload.error}` : ""}</p>
        {upload.status !== "failed" ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${upload.name} 上传进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${progress}%` }} />
        </div> : null}
        {upload.status === "failed" ? <button type="button" className="mt-1 text-label font-semibold text-danger-ink underline" onClick={onRetry}>重试</button> : <p className="mt-1 text-label font-semibold tabular-nums text-muted">{progress}%</p>}
      </div>
      {upload.status !== "failed" && onCancel ? <button type="button" className="rounded p-1 text-muted hover:bg-surface" onClick={onCancel} aria-label={`取消上传 ${upload.name}`} title="取消上传"><X className="h-3.5 w-3.5" /></button> : null}
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  function adjustZoom(delta: number) {
    setZoom((current) => {
      const next = Math.min(4, Math.max(0.25, Number((current + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanning(false);
    dragRef.current = null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPan: pan };
    setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.startPan.x + event.clientX - drag.startX, y: drag.startPan.y + event.clientY - drag.startY });
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLImageElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <Dialog open bare zIndex="viewer" onClose={onClose}>
      <div className="mx-auto flex max-h-[88vh] w-full max-w-5xl flex-col rounded-lg bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">图片预览</h3>
            <p className="mt-1 text-xs font-semibold text-muted">滚轮或按钮缩放，放大后拖拽平移。</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => adjustZoom(-0.25)} disabled={zoom <= 0.25} title="缩小" aria-label="缩小"><ZoomOut className="h-4 w-4" /></Button>
            <span className="w-12 text-center text-xs font-semibold text-muted">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" onClick={() => adjustZoom(0.25)} disabled={zoom >= 4} title="放大" aria-label="放大"><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={resetZoom} disabled={zoom === 1 && pan.x === 0 && pan.y === 0} title="复位" aria-label="复位"><RotateCcw className="h-4 w-4" /></Button>
            <a href={image} download="product-image" target="_blank" rel="noreferrer" title="下载当前图片" aria-label="下载当前图片" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"><Download className="h-4 w-4" /></a>
            <Button variant="secondary" size="sm" onClick={onClose}><X className="h-4 w-4" />关闭</Button>
          </div>
        </div>
        <div
          className="flex flex-1 items-center justify-center overflow-auto bg-surface-muted p-5"
          onWheel={(event) => { event.preventDefault(); adjustZoom(event.deltaY > 0 ? -0.1 : 0.1); }}
        >
          {loading ? <p className="text-sm font-semibold text-muted">正在下载</p> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="商品图片大图"
            className={`max-h-[78vh] max-w-full origin-center select-none object-contain ${loading ? "hidden" : ""} ${zoom > 1 ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onLoad={onLoad}
            onError={onLoad}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          />
        </div>
      </div>
    </Dialog>
  );
}
