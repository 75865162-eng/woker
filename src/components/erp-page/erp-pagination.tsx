"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 对应 Wimoor「主数据列表页 / 单据列表页」的服务端分页条。 */
export function ErpPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 20, 50, 100],
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizes?: number[];
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(pages, Math.max(1, page));
  const [jump, setJump] = useState(String(current));

  useEffect(() => {
    setJump(String(current));
  }, [current]);

  const goTo = (target: number) => {
    const next = Math.min(pages, Math.max(1, target));
    if (next !== current) onPageChange(next);
  };

  const commitJump = () => {
    const parsed = Number.parseInt(jump, 10);
    if (Number.isFinite(parsed)) {
      goTo(parsed);
      setJump(String(Math.min(pages, Math.max(1, parsed))));
    } else {
      setJump(String(current));
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-4 py-2.5 text-xs text-muted", className)}>
      <div className="flex items-center gap-2">
        <span>
          共 <span className="font-semibold tabular-nums text-foreground">{total}</span> 条 / 第{" "}
          <span className="font-semibold tabular-nums text-foreground">{current}</span>/{pages} 页
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          每页
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border border-border bg-white px-2 text-xs text-foreground"
          >
            {pageSizes.map((size) => <option key={size} value={size}>{size} 条</option>)}
            {!pageSizes.includes(pageSize) ? <option value={pageSize}>{pageSize} 条</option> : null}
          </select>
        </label>
        <div className="flex items-center gap-0.5">
          <Button type="button" size="icon" variant="ghost" disabled={current <= 1} aria-label="首页" title="首页" onClick={() => goTo(1)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" disabled={current <= 1} aria-label="上一页" title="上一页" onClick={() => goTo(current - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" disabled={current >= pages} aria-label="下一页" title="下一页" onClick={() => goTo(current + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" disabled={current >= pages} aria-label="末页" title="末页" onClick={() => goTo(pages)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex items-center gap-1">
          跳至
          <input
            type="number"
            min={1}
            max={pages}
            value={jump}
            onChange={(event) => setJump(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") commitJump(); }}
            onBlur={commitJump}
            aria-label="跳页页码"
            className="h-8 w-14 rounded-md border border-border bg-white px-2 text-xs text-foreground"
          />
          页
        </label>
      </div>
    </div>
  );
}
