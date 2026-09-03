"use client";

import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GripVertical,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import {
  labelClass,
  type ImagePreview,
} from "@/lib/listing-ai/workspace-draft";

export function ImageStrip({
  title,
  images,
  onUpload,
  mine,
  variant = "gallery",
}: {
  title: string;
  images: ImagePreview[];
  onUpload: (files: FileList | null) => void;
  mine?: boolean;
  variant?: "main" | "single" | "gallery";
}) {
  const previewHeight = variant === "gallery" ? "h-40" : "h-28";
  const gridClass = variant === "gallery" ? "grid-cols-3" : "grid-cols-1";

  return (
    <div className="rounded-md border border-border bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className={labelClass}>{title}</p>
        <MiniUploader images={images} label="Upload" onUpload={onUpload} />
      </div>
      <div className={`${previewHeight} overflow-hidden`}>
        {images.length ? (
          <div className={`grid ${gridClass} gap-2`}>
            {images.slice(0, variant === "gallery" ? 9 : 1).map((image) => (
              <GalleryCell
                key={image.url}
                image={image}
                mine={mine}
                compact={variant !== "gallery"}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
            No Images
          </div>
        )}
      </div>
    </div>
  );
}

export function AmazonLinkButton({ asin }: { asin: string }) {
  const cleanAsin = asin.trim();
  const disabled = !cleanAsin;

  return (
    <a
      aria-disabled={disabled}
      className={`flex h-10 items-center justify-center rounded-md border border-border bg-white text-muted transition ${
        disabled
          ? "pointer-events-none opacity-40"
          : "hover:bg-surface-muted hover:text-brand"
      }`}
      href={
        disabled
          ? undefined
          : `https://www.amazon.com/dp/${encodeURIComponent(cleanAsin)}`
      }
      rel="noreferrer"
      target="_blank"
      title="Open Amazon listing"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

export function GalleryCell({
  image,
  mine,
  compact,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onPreview,
}: {
  image?: ImagePreview;
  mine?: boolean;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onPreview?: () => void;
}) {
  return image ? (
    <div
      className={`group overflow-hidden rounded-md border ${mine ? "border-brand" : "border-border"} bg-white`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="relative">
        <button
          className={`${compact ? "h-20" : "aspect-square"} flex w-full cursor-zoom-in items-center justify-center bg-white`}
          onClick={onPreview}
          type="button"
          title="View large image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </button>
        {draggable ? (
          <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/95 text-muted shadow-sm hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              type="button"
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/95 text-muted shadow-sm hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              type="button"
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted">
        {draggable ? <GripVertical className="h-3.5 w-3.5 shrink-0" /> : null}
        <p className="truncate">{image.name}</p>
      </div>
    </div>
  ) : (
    <div
      className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      Empty
    </div>
  );
}

export function ImagePreviewModal({
  image,
  onClose,
}: {
  image: ImagePreview;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="truncate text-sm font-bold text-foreground">
            {image.name}
          </p>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-4" onClick={onClose}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            className="max-h-[78vh] max-w-full object-contain"
            loading="eager"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}

export function InfoField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-border bg-white p-4 ${className}`}
    >
      <p className={labelClass}>{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function AlignedPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted/60 p-4">
      <p className={labelClass}>{label}</p>
      <div className="mt-3 flex h-[calc(100%-28px)] items-center justify-center rounded-md bg-white/60 text-xs font-bold text-muted">
        不适用
      </div>
    </div>
  );
}
