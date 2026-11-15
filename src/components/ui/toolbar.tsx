"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 工具栏原语。统一 dashboard 的筛选条写法，替代全站 140 处手写的
 * `flex items-center justify-between` 组合。
 *
 * 控件高度与边框统一走 --control-h / border-border / rounded-md，
 * 与 product-workbench-shell 的表单保持一致。
 */

/** 输入类控件统一 class，select / input / 日期选择器都用它 */
export const controlClassName = "erp-field";

/** 紧凑控件（工具栏内联使用） */
export const controlSmClassName = "erp-field h-[var(--control-h-sm)] px-2.5 text-meta";

export function Toolbar({
  children,
  actions,
  className,
  variant = "card",
}: {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** card: 独立卡片容器；plain: 无外框，直接排版 */
  variant?: "card" | "plain";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        variant === "card" && "rounded-lg border border-border bg-surface px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** 带标签的字段：label 在上方，12px semibold muted，对齐 dashboard 表单 */
export function ToolbarField({
  label,
  children,
  className,
  inline = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  /** inline: 标签与控件同一行（工具栏场景常用） */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <label className={cn("inline-flex items-center gap-2 text-xs font-semibold text-muted", className)}>
        <span className="shrink-0">{label}</span>
        {children}
      </label>
    );
  }

  return (
    <label className={cn("block text-xs font-semibold text-muted", className)}>
      <span className="block">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/** 工具栏内的分隔线 */
export function ToolbarDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("h-5 w-px bg-border", className)} />;
}
