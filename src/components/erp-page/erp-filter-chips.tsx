"use client";

import { ListFilter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ErpFilterChip } from "./types";

/** 对应 Wimoor「主数据列表页 / 单据列表页」的已选筛选条件回显条。 */
export function ErpFilterChips({
  items,
  onRemove,
  onClear,
  className,
}: {
  items: ErpFilterChip[];
  onRemove?: (key: string) => void;
  onClear?: () => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs", className)}>
      <span className="inline-flex items-center gap-1 font-semibold text-muted">
        <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
        已选条件
      </span>
      {items.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-1 text-foreground">
          <span className="text-muted">{chip.label}：</span>
          <span className="font-semibold">{chip.value}</span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`移除筛选条件 ${chip.label}`}
              title={`移除 ${chip.label}`}
              onClick={() => onRemove(chip.key)}
              className="ml-0.5 rounded text-muted hover:bg-white hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {onClear ? (
        <button type="button" onClick={onClear} className="ml-auto rounded px-2 py-1 font-medium text-brand hover:bg-surface-muted">
          清空全部
        </button>
      ) : null}
    </div>
  );
}
