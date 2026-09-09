"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  GripVertical,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
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
      <div
        className={`relative ${
          compact
            ? "h-20 w-full max-h-20"
            : "aspect-square h-[226px] max-h-[226px] w-full max-w-[226px]"
        }`}
      >
        <button
          className="flex h-full w-full cursor-zoom-in items-center justify-center bg-white"
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustZoom(0.25);
      } else if (event.key === "-") {
        event.preventDefault();
        adjustZoom(-0.25);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      } else if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function adjustZoom(delta: number) {
    setZoom((current) => {
      const nextZoom = Math.min(
        3,
        Math.max(0.5, Number((current + delta).toFixed(2))),
      );

      if (nextZoom <= 1) {
        setPan({ x: 0, y: 0 });
      }

      return nextZoom;
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    panDragRef.current = null;
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    event.stopPropagation();

    if (zoom <= 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPan: pan,
    };
    setIsPanning(true);
  }

  function handlePreviewPointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = panDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    setPan({
      x: drag.startPan.x + event.clientX - drag.startX,
      y: drag.startPan.y + event.clientY - drag.startY,
    });
  }

  function handlePreviewPointerEnd(event: ReactPointerEvent<HTMLImageElement>) {
    if (panDragRef.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      panDragRef.current = null;
      setIsPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

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
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => adjustZoom(-0.25)}
              disabled={zoom <= 0.5}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs font-semibold text-muted">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => adjustZoom(0.25)}
              disabled={zoom >= 3}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={resetZoom}
              disabled={zoom === 1}
              title="Reset zoom"
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} title="Close" aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div
          className="flex min-h-0 max-h-[78vh] flex-1 items-center justify-center overflow-auto bg-surface-muted p-4"
          onClick={onClose}
          onWheel={(event) => {
            event.preventDefault();
            adjustZoom(event.deltaY > 0 ? -0.1 : 0.1);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            className={`max-h-[78vh] max-w-full origin-center select-none object-contain transition-transform duration-150 ${
              zoom > 1
                ? isPanning
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : "cursor-zoom-in"
            }`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            loading="eager"
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerEnd}
            onPointerCancel={handlePreviewPointerEnd}
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
