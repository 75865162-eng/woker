"use client";

import { useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";

export function MiniUploader({
  images,
  onUpload,
  label = "Upload",
}: {
  images: ImagePreview[];
  onUpload: (files: FileList | null) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex min-w-28 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs font-bold text-muted hover:bg-surface-muted">
      <Upload className="h-4 w-4" />
      {images.length ? `${images.length} Images` : label}
      <input
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => onUpload(event.target.files)}
      />
    </label>
  );
}

export function ImagePreviewGrid({
  images,
  compact = false,
}: {
  images: ImagePreview[];
  compact?: boolean;
}) {
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);

  if (!images.length) {
    return (
      <div
        className={`flex aspect-square items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted ${
          compact ? "w-full" : "mt-3 w-full max-w-72"
        }`}
      >
        暂无图片
      </div>
    );
  }

  return (
    <>
      <div
        className={`grid gap-2 ${
          compact
            ? "grid-cols-[repeat(auto-fill,minmax(96px,96px))]"
            : "mt-3 grid-cols-[repeat(auto-fill,minmax(112px,112px))]"
        }`}
      >
        {images.map((image) => (
          <button
            key={`${image.name}-${image.url.slice(0, 24)}`}
            type="button"
            className="overflow-hidden rounded-md border border-border bg-white text-left"
            onClick={() => setPreviewImage(image)}
            title="查看原图"
          >
            <div
              className={`flex items-center justify-center bg-white ${
                compact ? "h-24" : "h-28"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="h-full w-full object-contain p-1"
                src={image.url}
                alt={image.name}
                loading="lazy"
              />
            </div>
            <div className="truncate border-t border-border px-2 py-1 text-[11px] font-semibold text-muted">
              {image.name}
            </div>
          </button>
        ))}
      </div>
      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="truncate text-sm font-bold text-foreground">
                {previewImage.name}
              </p>
              <Button variant="ghost" size="icon" onClick={() => setPreviewImage(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-4" onClick={() => setPreviewImage(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImage.url}
            alt={previewImage.name}
            className="max-h-[78vh] max-w-full object-contain"
            loading="eager"
            onClick={(event) => event.stopPropagation()}
          />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
