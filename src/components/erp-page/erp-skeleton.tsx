"use client";

import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-muted", className)} />;
}

/** 对应 Wimoor 各页面模式的加载占位：整页 / 统计条 / 表格 / 卡片。 */
export function ErpSkeleton({ variant = "page" }: { variant?: "page" | "stats" | "table" | "card" }) {
  if (variant === "card") {
    return (
      <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <Bar className="mb-4 h-4 w-1/3" />
        <div className="space-y-2">
          <Bar className="h-3 w-full" />
          <Bar className="h-3 w-5/6" />
          <Bar className="h-3 w-2/3" />
        </div>
      </div>
    );
  }

  if (variant === "stats") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
            <div className="h-1 w-full bg-surface-muted" />
            <div className="space-y-3 p-4">
              <Bar className="h-3 w-1/2" />
              <Bar className="h-7 w-2/3" />
              <Bar className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="flex gap-4 border-b border-border bg-surface-muted px-4 py-3">
          {Array.from({ length: 5 }, (_, i) => <Bar key={i} className="h-3 flex-1" />)}
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0">
            {Array.from({ length: 5 }, (_, col) => <Bar key={col} className="h-3 flex-1" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Bar className="h-3 w-48" />
      <div className="flex items-center justify-between gap-4">
        <Bar className="h-7 w-56" />
        <Bar className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Bar key={i} className="h-24 w-full" />)}
      </div>
      <Bar className="h-10 w-full" />
      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="border-b border-border bg-surface-muted px-4 py-3"><Bar className="h-3 w-1/3" /></div>
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="border-b border-border px-4 py-3 last:border-b-0"><Bar className="h-3 w-2/3" /></div>
        ))}
      </div>
    </div>
  );
}
