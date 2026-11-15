"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErpEmptyState } from "./erp-empty-state";
import { ErpSkeleton } from "./erp-skeleton";
import type { ErpColumn } from "./types";

export type ErpSort = { key: string; direction: "asc" | "desc" };

export type ErpDataTableProps<T> = {
  columns: ErpColumn<T>[];
  rows: T[];
  loading?: boolean;
  /** 自定义空态内容；不传时使用内置 ErpEmptyState。 */
  empty?: ReactNode;
  rowKey: (row: T, index: number) => string;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectedKeysChange?: (keys: Set<string>) => void;
  sort?: ErpSort | null;
  onSortChange?: (sort: ErpSort | null) => void;
  /** 合计行，键为 ErpColumn.key。 */
  summary?: Record<string, ReactNode>;
  dense?: boolean;
  onRowClick?: (row: T, index: number) => void;
  stickyHeader?: boolean;
  className?: string;
};

type Align = "left" | "right" | "center";

const alignClass: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function cellContent<T>(column: ErpColumn<T>, row: T, index: number): ReactNode {
  if (column.render) return column.render(row, index);
  if (column.value) return column.value(row) ?? "";
  const raw = (row as unknown as Record<string, unknown>)[column.key];
  return typeof raw === "string" || typeof raw === "number" ? raw : "";
}

/** 对应 Wimoor「主数据列表页 / 单据列表页 / 主从双视图」的列配置驱动表格。 */
export function ErpDataTable<T>({
  columns,
  rows,
  loading = false,
  empty,
  rowKey,
  selectable = false,
  selectedKeys,
  onSelectedKeysChange,
  sort = null,
  onSortChange,
  summary,
  dense = false,
  onRowClick,
  stickyHeader = true,
  className,
}: ErpDataTableProps<T>) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const keys = rows.map((row, index) => rowKey(row, index));
  const selected = selectedKeys ?? new Set<string>();
  const selectedCount = keys.filter((key) => selected.has(key)).length;
  const allSelected = keys.length > 0 && selectedCount === keys.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selected);
    if (allSelected) keys.forEach((key) => next.delete(key));
    else keys.forEach((key) => next.add(key));
    onSelectedKeysChange(next);
  };

  const toggleOne = (key: string) => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedKeysChange(next);
  };

  // 排序三态循环：无 -> asc -> desc -> 无。
  const cycleSort = (column: ErpColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    if (!sort || sort.key !== column.key) {
      onSortChange({ key: column.key, direction: "asc" });
      return;
    }
    if (sort.direction === "asc") {
      onSortChange({ key: column.key, direction: "desc" });
      return;
    }
    onSortChange(null);
  };

  if (loading) return <ErpSkeleton variant="table" />;

  const cellPadding = dense ? "px-3 py-1.5" : "px-3 py-2.5";
  const stickyClass = stickyHeader ? "sticky top-0 z-10 bg-surface-muted" : "";

  return (
    <div className={cn("overflow-auto rounded-lg border border-border bg-white", className)}>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-muted">
          <tr>
            {selectable ? (
              <th scope="col" className={cn("w-10 border-b border-border", cellPadding, stickyClass)}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={keys.length === 0 || !onSelectedKeysChange}
                  aria-label="全选当前页"
                  className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed"
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const activeDirection = sort && sort.key === column.key ? sort.direction : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  title={column.hint}
                  style={column.width ? { width: column.width } : undefined}
                  className={cn("border-b border-border font-semibold text-foreground", alignClass[column.align ?? "left"], cellPadding, stickyClass)}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => cycleSort(column)}
                      aria-label={`按 ${column.label} 排序`}
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white hover:text-brand"
                    >
                      {column.label}
                      {activeDirection === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-brand" />
                      ) : activeDirection === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5 text-brand" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 text-muted" />
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {rows.length > 0 ? (
          <tbody>
            {rows.map((row, index) => {
              const key = keys[index];
              const isSelected = selected.has(key);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    isSelected && "bg-brand/5",
                    onRowClick && "cursor-pointer hover:bg-surface-muted",
                  )}
                >
                  {selectable ? (
                    <td className={cellPadding} onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(key)}
                        disabled={!onSelectedKeysChange}
                        aria-label={`选择第 ${index + 1} 行`}
                        className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed"
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} className={cn("text-foreground", alignClass[column.align ?? "left"], cellPadding)}>
                      {cellContent(column, row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ) : null}
        {summary && rows.length > 0 ? (
          <tfoot>
            <tr className="border-t border-border bg-surface-muted font-semibold text-foreground">
              {selectable ? <td className={cellPadding} /> : null}
              {columns.map((column) => (
                <td key={column.key} className={cn(alignClass[column.align ?? "left"], cellPadding)}>
                  {summary[column.key] ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {rows.length === 0 ? (empty ?? <ErpEmptyState />) : null}
    </div>
  );
}
