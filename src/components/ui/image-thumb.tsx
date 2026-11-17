"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 列表/卡片缩略图：固定尺寸容器防布局抖动，加载中显示骨架，
 * 失败或无图显示名称首字兜底。加载懒执行、异步解码。
 */
export function ImageThumb({
  src,
  alt,
  fallback,
  className,
  imgClassName,
  referrerPolicy,
}: {
  src?: string | null;
  alt?: string;
  /** 无图或失败时展示的文字，通常传商品标题或 ASIN */
  fallback?: string;
  className?: string;
  imgClassName?: string;
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");

  const initial = (fallback || alt || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted",
        className,
      )}
    >
      {status === "loading" ? (
        <span className="absolute inset-0 animate-pulse bg-surface-muted" aria-hidden />
      ) : null}
      {status === "error" ? (
        <span className="text-xs font-bold text-muted" aria-label={alt || "商品主图"}>{initial}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={alt || "商品主图"}
          loading="lazy"
          decoding="async"
          referrerPolicy={referrerPolicy}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={cn(
            "h-full w-full object-contain transition-opacity",
            status === "loading" ? "opacity-0" : "opacity-100",
            imgClassName,
          )}
        />
      )}
    </span>
  );
}
