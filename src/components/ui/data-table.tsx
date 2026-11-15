"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 表格内核。
 *
 * 六种业务表格（Standard / Dense / Finance / Editable / Grouped / Task）
 * 共用这里的渲染、密度、状态与可访问性，差异只在「列怎么摆、行怎么组织」。
 *
 * 视觉规则（全站唯一）：
 * - 容器 rounded-lg border border-border bg-surface
 * - 表头 sticky、bg-surface-muted、12px 常规字重 muted
 * - 行高走密度令牌，tr 的 height 在 border-collapse 下等同 min-height，
 *   所以单行内容按 40px 渲染、双行内容自动撑高，不会挤掉内容
 * - 数字列右对齐 + 等宽数字
 */

export type TableDensity = "inherit" | "compact" | "standard" | "comfortable";

/** 旧名兼容：上一轮的 DataTable 用的是 default/compact/comfortable */
export type DataTableDensity = "default" | "comfortable" | "compact";

const rowHeightByDensity: Record<TableDensity, string> = {
  inherit: "var(--row-h)",
  compact: "var(--row-compact)",
  standard: "var(--row-h)",
  comfortable: "var(--row-comfortable)",
};

function resolveDensity(density: TableDensity | DataTableDensity): TableDensity {
  if (density === "default") return "standard";
  return density as TableDensity;
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  /** 像素列宽；全部列都提供时走 table-fixed + colgroup */
  width?: number;
  align?: "left" | "right" | "center";
  /** 数字列：右对齐 + 等宽数字 */
  numeric?: boolean;
  sortable?: boolean;
  sortDirection?: "asc" | "desc" | null;
  onSort?: () => void;
  className?: string;
  headerClassName?: string;
  /** 首列冻结时的固定宽度，不提供则按列宽 */
  sticky?: boolean;
  /** data-* 透传到该列的 <td>，供测试与埋点使用 */
  cellAttributes?: (row: T) => Record<string, string | number | undefined>;
  render: (row: T, index: number) => ReactNode;
}

export interface DataTableSelection {
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onToggleAll?: (checked: boolean) => void;
  /** 提供后该行禁止选中 */
  disabled?: (row: unknown) => boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  density?: TableDensity | DataTableDensity;
  /** 工具条左侧标题 */
  title?: ReactNode;
  /** 工具条右侧计数 / 状态 */
  meta?: ReactNode;
  /** 工具条右侧操作 */
  actions?: ReactNode;
  /** 工具条左侧附加内容（搜索框、筛选器） */
  toolbarLeft?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  /** 错误态：优先于空态显示，带重试 */
  error?: { message: string; onRetry?: () => void };
  /** 滚动区最大高度 */
  maxHeight?: string;
  stickyHeader?: boolean;
  /** 首列左右冻结，长表横向滚动时保留标识列 */
  stickyFirstColumn?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** data-* 透传到 <tr>，供测试与埋点使用 */
  rowAttributes?: (row: T) => Record<string, string | number | undefined>;
  className?: string;
  ariaLabel?: string;
  /** 表尾合计行 */
  footer?: ReactNode;
  selection?: DataTableSelection;
}

function SortIcon({ direction }: { direction?: "asc" | "desc" | null }) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return <Icon aria-hidden className="h-3 w-3 shrink-0 opacity-60" />;
}

function alignClass(column: DataTableColumn<unknown>) {
  if (column.align === "right" || column.numeric) return "text-right";
  if (column.align === "center") return "text-center";
  return "text-left";
}

/** 选中框：原生 checkbox，样式走 accent-color，不需要额外状态 */
function SelectionCell({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(node) => {
        if (node) {
          node.indeterminate = indeterminate && !checked;
        }
      }}
      onChange={(event) => onChange(event.target.checked)}
      className="h-3.5 w-3.5 cursor-pointer rounded-sm border-border accent-brand disabled:cursor-not-allowed"
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  density = "inherit",
  title,
  meta,
  actions,
  toolbarLeft,
  empty,
  loading = false,
  error,
  maxHeight,
  stickyHeader = true,
  stickyFirstColumn = false,
  onRowClick,
  rowClassName,
  rowAttributes,
  className,
  ariaLabel,
  footer,
  selection,
}: DataTableProps<T>) {
  const resolvedDensity = resolveDensity(density);
  const rowHeight = rowHeightByDensity[resolvedDensity];
  const hasToolbar = Boolean(title || meta || actions || toolbarLeft);
  const totalWidth = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const fixedLayout = columns.every((column) => typeof column.width === "number") && totalWidth > 0;
  const columnCount = columns.length + (selection ? 1 : 0);

  const selectedCount = selection ? rows.filter((row) => selection.selectedKeys.has(getRowKey(row))).length : 0;
  const selectableRows = selection
    ? rows.filter((row) => !selection.disabled?.(row))
    : [];
  const allSelected = selection
    ? selectableRows.length > 0 && selectableRows.every((row) => selection.selectedKeys.has(getRowKey(row)))
    : false;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {hasToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {title ? <p className="shrink-0 truncate text-section text-foreground">{title}</p> : null}
            {toolbarLeft}
            {loading && rows.length > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted">
                <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                正在更新
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-meta text-muted">
            {selection && selectedCount > 0 ? (
              <span className="font-semibold text-brand">已选 {selectedCount}</span>
            ) : null}
            {meta ? <span>{meta}</span> : null}
            {actions}
          </div>
        </div>
      ) : null}

      <div className={cn("thin-scrollbar overflow-auto", maxHeight ? undefined : "max-h-none")} style={maxHeight ? { maxHeight } : undefined}>
        <table
          aria-label={ariaLabel}
          className={cn(
            "text-left text-table",
            fixedLayout ? "table-fixed" : "w-full",
            "[&_td]:overflow-hidden [&_td]:align-middle",
          )}
          style={{ width: fixedLayout ? `max(${totalWidth}px, 100%)` : undefined }}
        >
          {fixedLayout ? (
            <colgroup>
              {selection ? <col style={{ width: "40px" }} /> : null}
              {columns.map((column) => (
                <col key={column.key} style={{ width: `${column.width}px` }} />
              ))}
            </colgroup>
          ) : null}
          <thead className={cn("bg-surface-muted text-meta text-muted", stickyHeader && "sticky top-0 z-10")}>
            <tr>
              {selection ? (
                <th scope="col" className="w-10 px-[var(--cell-px)] py-2">
                  <SelectionCell
                    checked={allSelected}
                    indeterminate={someSelected}
                    disabled={selectableRows.length === 0}
                    onChange={(checked) => selection.onToggleAll?.(checked)}
                    label="全选当前页"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const isSticky = stickyFirstColumn && (column.sticky ?? column === columns[0]);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "px-[var(--cell-px)] py-2 font-normal",
                      alignClass(column as DataTableColumn<unknown>),
                      isSticky && "sticky left-0 z-[2] bg-surface-muted",
                      column.headerClassName,
                    )}
                  >
                    {column.sortable && column.onSort ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex max-w-full items-center gap-1 hover:text-foreground",
                          column.align === "right" || column.numeric ? "justify-end" : "text-left",
                        )}
                        onClick={column.onSort}
                        aria-label={`按${typeof column.header === "string" ? column.header : column.key}排序`}
                      >
                        <span className="truncate">{column.header}</span>
                        <SortIcon direction={column.sortDirection} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-12 text-center">
                  <div className="inline-flex flex-col items-center gap-2">
                    <AlertTriangle aria-hidden className="h-5 w-5 text-danger" />
                    <p className="text-body text-danger-ink">{error.message}</p>
                    {error.onRetry ? (
                      <button
                        type="button"
                        onClick={error.onRetry}
                        className="mt-1 h-[var(--control-h-sm)] rounded-md border border-border px-3 text-meta font-semibold text-foreground hover:bg-surface-muted"
                      >
                        重试
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-12 text-center text-body text-muted">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                      加载中…
                    </span>
                  ) : (
                    <span className="inline-flex flex-col items-center gap-2">
                      <Inbox aria-hidden className="h-5 w-5 text-border-strong" />
                      {empty ?? "暂无数据"}
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const key = getRowKey(row);
                const isSelected = selection?.selectedKeys.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    style={{ height: rowHeight }}
                    {...(rowAttributes?.(row) ?? {})}
                    aria-selected={selection ? isSelected : undefined}
                    className={cn(
                      "border-t border-border/70 align-middle transition-colors",
                      onRowClick && "cursor-pointer",
                      isSelected ? "bg-brand/5 hover:bg-brand/8" : "hover:bg-surface-muted/60",
                      rowClassName?.(row),
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selection ? (
                      <td className="px-[var(--cell-px)] py-[var(--cell-py)]">
                        <SelectionCell
                          checked={isSelected}
                          disabled={selection.disabled?.(row)}
                          onChange={() => selection.onToggle(key)}
                          label={`选择第 ${index + 1} 行`}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const isSticky = stickyFirstColumn && (column.sticky ?? column === columns[0]);
                      return (
                        <td
                          key={column.key}
                          {...(column.cellAttributes?.(row) ?? {})}
                          className={cn(
                            "px-[var(--cell-px)] py-[var(--cell-py)]",
                            alignClass(column as DataTableColumn<unknown>),
                            column.numeric && "metric-tabular",
                            isSticky && "sticky left-0 z-[1] bg-surface",
                            isSelected && isSticky && "bg-surface",
                            column.className,
                          )}
                        >
                          {column.render(row, index)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer ? <tfoot className="border-t border-border bg-surface-muted/60">{footer}</tfoot> : null}
        </table>
      </div>
    </div>
  );
}
