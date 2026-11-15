"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 指标条原语。dashboard 目前没有独立的指标区，此处按 dashboard 的语言补齐：
 * 标签 12px muted，数值 20px bold + tabular-nums（与页面标题同级），
 * 容器沿用 rounded-lg border-border bg-surface。
 *
 * value 用 ReactNode 而非 number：金额与大整数按现有约定以字符串传入，
 * 展示层不做数值转换，避免精度丢失。
 */

export type StatTone = "default" | "success" | "danger" | "warning" | "accent";

const toneClass: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
  warning: "text-accent",
  accent: "text-brand",
};

export interface StatItem {
  key: string;
  label: ReactNode;
  /** 已格式化好的展示值，字符串或节点；不要在此处做浮点运算 */
  value: ReactNode;
  /** 辅助说明，如「较昨日 +3」 */
  hint?: ReactNode;
  tone?: StatTone;
}

export function StatStrip({
  items,
  className,
  title,
  actions,
}: {
  items: StatItem[];
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  if (!items.length) return null;

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title ? <p className="text-sm font-bold text-foreground">{title}</p> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] divide-x divide-border">
        {items.map((item) => (
          <div key={item.key} className="min-w-0 px-4 py-3">
            <p className="truncate text-xs text-muted">{item.label}</p>
            <p
              className={cn(
                "mt-1 truncate text-xl font-bold metric-tabular",
                toneClass[item.tone ?? "default"],
              )}
              title={typeof item.value === "string" ? item.value : undefined}
            >
              {item.value}
            </p>
            {item.hint ? <p className="mt-0.5 truncate text-xs text-muted">{item.hint}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
