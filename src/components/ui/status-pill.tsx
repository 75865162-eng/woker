"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 语义状态药丸。用于替代散落各处的 bg-danger-soft / bg-warning-soft / bg-success-soft
 * 与 --sf-* 变量混用（审计 R4）。
 *
 * 结构沿用现有 ui/badge.tsx（rounded-full + 0.5 边框 + 12px semibold），
 * 但取色走 --*-soft 语义令牌，便于统一调整。
 */
export type StatusTone = "neutral" | "success" | "danger" | "warning" | "info" | "brand";

const toneClass: Record<StatusTone, string> = {
  neutral: "border-border bg-surface-muted text-muted",
  success: "border-success/25 bg-success-soft text-success-ink",
  danger: "border-danger/25 bg-danger-soft text-danger-ink",
  warning: "border-accent/30 bg-warning-soft text-warning-ink",
  info: "border-info/25 bg-info-soft text-info-ink",
  brand: "border-brand/25 bg-info-soft text-brand",
};

export function StatusPill({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
  /** 前置色点，用于弱化纯色依赖 */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
