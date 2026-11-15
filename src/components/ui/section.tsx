"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 区块容器与区块头。统一 dashboard 的卡片语言：
 * 容器 rounded-lg border-border bg-surface，头部 border-b px-4 py-3。
 *
 * 注意：现有 ui/card.tsx 使用 px-5 py-4，与表格工具条的 px-4 py-3 不一致。
 * 为不影响 46 个既有调用点，P0 阶段不动 card.tsx，新代码统一用 Section。
 */
export function Section({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {children}
    </Tag>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  size = "sm",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** sm: 14/600（表格工具条级）；lg: 18/700（analog dashboard「处理记录」） */
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className={size === "lg" ? "text-title text-foreground" : "text-sm font-bold text-foreground"}>
          {title}
        </p>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}
