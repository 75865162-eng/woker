"use client";

import { useRef } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import type { StudioImage } from "@/lib/listing-ai/studio";
import { cn } from "@/lib/utils";

export const inputClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-brand focus:ring-1 focus:ring-brand/30 disabled:bg-surface-muted disabled:text-muted";

export const textareaClass = cn(inputClass, "resize-y leading-relaxed");

export function FieldLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-xs font-bold text-foreground">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {hint ? <span className="shrink-0 text-[11px] text-muted">{hint}</span> : null}
    </div>
  );
}

export function CharMeter({
  value,
  max,
  unit = "字符",
  className,
}: {
  value: number;
  max: number;
  unit?: string;
  className?: string;
}) {
  const ratio = max > 0 ? value / max : 0;
  const over = value > max;
  const warn = !over && ratio >= 0.9;
  const width = `${Math.min(100, Math.round(ratio * 100))}%`;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over ? "bg-danger" : warn ? "bg-accent" : "bg-success",
          )}
          style={{ width }}
        />
      </div>
      <span
        className={cn(
          "text-[11px] tabular-nums",
          over ? "font-bold text-danger" : warn ? "font-bold text-foreground" : "text-muted",
        )}
      >
        {value}/{max} {unit}
      </span>
    </div>
  );
}

export function ImageUploader({
  title,
  hint,
  images,
  limit,
  uploading,
  onUpload,
  onRemove,
  viewLabels,
}: {
  title: string;
  hint: string;
  images: StudioImage[];
  limit: number;
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  viewLabels?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-md border border-border bg-surface-muted/40 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-foreground">{title}</span>
        <span
          className={cn(
            "text-[11px] tabular-nums",
            images.length >= limit ? "font-bold text-foreground" : "text-muted",
          )}
        >
          {images.length}/{limit}
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-muted">{hint}</p>
      <div className="grid grid-cols-4 gap-2">
        {images.map((image, index) => (
          <div
            key={`${image.assetId ?? image.url}-${index}`}
            className="group relative aspect-square overflow-hidden rounded-md border border-border bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {viewLabels?.[index] ? (
              <span className="absolute left-0 top-0 bg-black/55 px-1 py-0.5 text-[9px] font-bold text-white">
                {viewLabels[index]}
              </span>
            ) : null}
            <span className="absolute inset-x-0 bottom-0 hidden truncate bg-black/55 px-1 py-0.5 text-[9px] text-white group-hover:block">
              {image.name}
            </span>
            <button
              type="button"
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
              onClick={() => onRemove(index)}
              aria-label={`移除 ${image.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {images.length < limit ? (
          <button
            type="button"
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-white text-muted transition hover:border-brand hover:text-brand disabled:opacity-60"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            <span className="text-[10px]">上传</span>
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onUpload(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
