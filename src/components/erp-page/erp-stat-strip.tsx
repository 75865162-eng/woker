"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErpSkeleton } from "./erp-skeleton";
import type { ErpStat, ErpTone } from "./types";

/** 响应式列数使用静态 Tailwind 类，避免动态拼接类名无法被扫描；columns 收敛到 1~6。 */
const gridByColumns: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

const toneBar: Record<ErpTone, string> = {
  default: "bg-muted",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-accent",
  danger: "bg-danger",
  info: "bg-info",
};

const toneText: Record<ErpTone, string> = {
  default: "text-foreground",
  brand: "text-brand",
  success: "text-success",
  warning: "text-amber-600",
  danger: "text-danger",
  info: "text-info",
};

/** 对应 Wimoor「统计报表页 / 主数据列表页」顶部的 KPI 指标条。 */
export function ErpStatStrip({
  items,
  loading = false,
  columns = 4,
  className,
  compact = false,
}: {
  items: ErpStat[];
  loading?: boolean;
  columns?: number;
  className?: string;
  /** 紧凑单行变体：用于 PageFrame 首屏 KPI，不挤占业务数据区。 */
  compact?: boolean;
}) {
  const safeColumns = Math.min(6, Math.max(1, Math.round(columns)));
  const gridClass = gridByColumns[safeColumns] ?? gridByColumns[4];

  if (loading) return <ErpSkeleton variant="stats" />;
  if (items.length === 0) return null;

  if (compact) {
    return (
      <div className={cn("grid gap-1.5", gridClass, className)}>
        {items.map((stat) => {
          const tone = stat.tone ?? "default";
          const interactive = Boolean(stat.href || stat.onClick);
          const shell = cn(
            "flex min-w-0 flex-row items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5 text-left",
            interactive && "transition-colors hover:border-brand/40 hover:bg-surface-muted/40",
          );
          const content = (
            <>
              <span className={cn("h-6 w-1 shrink-0 rounded-full", toneBar[tone])} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-muted">{stat.label}</span>
                <span className={cn("block truncate text-sm font-bold tabular-nums", toneText[tone])}>{stat.value}</span>
              </span>
              {stat.hint ? <span className="hidden truncate text-[11px] text-muted xl:block">{stat.hint}</span> : null}
            </>
          );
          if (stat.href) return <a key={stat.id} href={stat.href} className={shell}>{content}</a>;
          if (stat.onClick) return <button key={stat.id} type="button" onClick={stat.onClick} className={shell}>{content}</button>;
          return <div key={stat.id} className={shell}>{content}</div>;
        })}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3", gridClass, className)}>
      {items.map((stat) => {
        const tone = stat.tone ?? "default";
        const interactive = Boolean(stat.href || stat.onClick);
        const shell = cn(
          "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-white text-left shadow-sm",
          interactive && "transition-colors hover:border-brand/40 hover:bg-surface-muted/40",
        );
        const content = (
          <>
            <div className={cn("h-1 w-full", toneBar[tone])} />
            <div className="flex flex-1 flex-col gap-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">{stat.label}</span>
                {interactive ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                ) : null}
              </div>
              <div className={cn("text-2xl font-bold tabular-nums", toneText[tone])}>{stat.value}</div>
              {stat.hint ? <p className="mt-0.5 text-xs text-muted">{stat.hint}</p> : null}
            </div>
          </>
        );

        if (stat.href) {
          return <a key={stat.id} href={stat.href} className={shell}>{content}</a>;
        }
        if (stat.onClick) {
          return <button key={stat.id} type="button" onClick={stat.onClick} className={shell}>{content}</button>;
        }
        return <div key={stat.id} className={shell}>{content}</div>;
      })}
    </div>
  );
}
