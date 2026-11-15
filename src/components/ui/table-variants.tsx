"use client";

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Columns3, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn, type DataTableProps } from "./data-table";

/**
 * 六种业务表格。
 *
 * 这里刻意不做成「一个大组件配一堆开关」：
 * - Standard / Dense / Finance / Task 是 DataTable 的配置化身（列怎么摆不同）
 * - Editable / Grouped 有各自的行走组织方式，单独实现，但共用同一套视觉类
 *
 * 共同约定：
 * - 视觉类只从这里取（tableSkin / thSkin / tdSkin），业务页不再手写表格样式
 * - 金额与数量一律字符串进出，不在表格层做浮点运算
 */

const tableSkin = "w-full border-collapse text-left text-table text-foreground";
const thSkin = "bg-surface-muted px-[var(--cell-px)] py-2 text-meta font-normal text-muted";
const tdSkin = "px-[var(--cell-px)] py-[var(--cell-py)] align-middle";

/* ============================================================================
 * 1. StandardDataTable —— 列表页主力
 * ========================================================================== */

export interface SearchSpec {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 受控：由调用方做实际过滤，表格只负责输入与清空 */
  onClear?: () => void;
}

export interface StandardDataTableProps<T> extends DataTableProps<T> {
  search?: SearchSpec;
  /** 列显隐：不传则不出现「列」按钮 */
  columnToggle?: boolean;
  /** 固定不参与显隐的列 key */
  pinnedColumnKeys?: string[];
}

export function StandardDataTable<T>({
  search,
  columnToggle = false,
  pinnedColumnKeys = [],
  toolbarLeft,
  columns,
  ...rest
}: StandardDataTableProps<T>) {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenKeys.includes(column.key)),
    [columns, hiddenKeys],
  );

  const toggleColumn = (key: string) => {
    setHiddenKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const searchNode = search ? (
    <div className="relative">
      <input
        type="search"
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder ?? "搜索"}
        aria-label={search.placeholder ?? "搜索"}
        className="erp-field h-[var(--control-h-sm)] w-56 pr-7 text-meta"
      />
      {search.value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            search.onChange("");
            search.onClear?.();
          }}
          className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  ) : null;

  const columnNode = columnToggle ? (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setColumnMenuOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={columnMenuOpen}
        className="flex h-[var(--control-h-sm)] items-center gap-1 rounded-md border border-border bg-surface px-2 text-meta text-foreground hover:bg-surface-muted"
      >
        <Columns3 aria-hidden className="h-3.5 w-3.5 text-muted" />
        列
        {hiddenKeys.length > 0 ? <span className="text-brand">（隐藏 {hiddenKeys.length}）</span> : null}
        <ChevronDown aria-hidden className="h-3 w-3 text-muted" />
      </button>
      {columnMenuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-3"
        >
          {columns.map((column) => {
            const pinned = pinnedColumnKeys.includes(column.key);
            const visible = !hiddenKeys.includes(column.key);
            return (
              <label
                key={column.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-meta hover:bg-surface-muted",
                  pinned && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={pinned}
                  onChange={() => toggleColumn(column.key)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                <span className="truncate">{typeof column.header === "string" ? column.header : column.key}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <DataTable
      {...rest}
      columns={visibleColumns}
      toolbarLeft={
        searchNode || columnNode || toolbarLeft ? (
          <>
            {searchNode}
            {toolbarLeft}
            {columnNode}
          </>
        ) : undefined
      }
    />
  );
}

/* ============================================================================
 * 2. DenseDataTable —— 仓库、库存、对账等长表
 * ========================================================================== */

export function DenseDataTable<T>({ maxHeight = "min(70vh,760px)", ...rest }: DataTableProps<T>) {
  return <DataTable {...rest} density="compact" maxHeight={maxHeight} stickyFirstColumn />;
}

/* ============================================================================
 * 3. FinanceDataTable —— 财务专用：等宽数字 + 合计行
 * ========================================================================== */

export interface FinanceTotalColumn<T> {
  key: string;
  /** 返回已格式化的字符串；表格层不参与四则运算，避免浮点误差 */
  compute: (rows: T[]) => string;
  align?: "left" | "right" | "center";
}

export interface FinanceDataTableProps<T> extends DataTableProps<T> {
  totalLabel?: string;
  /** 需要合计的列；不传则不出现表尾 */
  totalColumns?: FinanceTotalColumn<T>[];
  /** 借贷方向着色：负数红、正数绿（中国财务惯例：借方蓝、贷方红由调用方决定） */
  signTone?: boolean;
}

export function FinanceDataTable<T>({
  totalLabel = "合计",
  totalColumns,
  rows,
  columns,
  footer,
  ...rest
}: FinanceDataTableProps<T>) {
  const totalRow =
    totalColumns && totalColumns.length > 0 ? (
      <tr className="text-body font-semibold text-foreground" style={{ height: "var(--row-h)" }}>
        <td className={cn(tdSkin, "text-left")} colSpan={1}>
          {totalLabel}
        </td>
        {columns.slice(1).map((column) => {
          const total = totalColumns.find((item) => item.key === column.key);
          return (
            <td
              key={column.key}
              className={cn(
                tdSkin,
                "metric-tabular",
                total?.align === "left" ? "text-left" : total?.align === "center" ? "text-center" : "text-right",
              )}
            >
              {total ? total.compute(rows) : null}
            </td>
          );
        })}
      </tr>
    ) : null;

  return (
    <DataTable
      {...rest}
      rows={rows}
      columns={columns}
      footer={totalRow ?? footer}
      density={rest.density ?? "standard"}
    />
  );
}

/* ============================================================================
 * 4. EditableDataTable —— 逐格编辑：盘点数量、采购单价、费用调整
 * ========================================================================== */

export interface EditableColumn<T> extends DataTableColumn<T> {
  editable?: boolean | ((row: T) => boolean);
  /** 编辑态取值 */
  value?: (row: T) => string;
  inputType?: "text" | "number";
  options?: { value: string; label: string }[];
  /** 返回错误文案则阻止提交 */
  validate?: (value: string, row: T) => string | null;
  onCommit?: (row: T, value: string) => void | Promise<void>;
}

export interface EditableDataTableProps<T> extends Omit<DataTableProps<T>, "columns"> {
  columns: EditableColumn<T>[];
  /** 提交失败时由调用方抛出，表格显示错误并保留编辑态 */
  onError?: (message: string) => void;
}

export function EditableDataTable<T>({ columns, onError, ...rest }: EditableDataTableProps<T>) {
  const [editing, setEditing] = useState<{ rowKey: string; columnKey: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const getRowKey = rest.getRowKey;

  const commit = async (row: T, column: EditableColumn<T>) => {
    const message = column.validate?.(draft, row) ?? null;
    if (message) {
      setError(message);
      return;
    }

    try {
      await column.onCommit?.(row, draft);
      setEditing(null);
      setError(null);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "保存失败";
      setError(text);
      onError?.(text);
    }
  };

  const merged: EditableColumn<T>[] = columns.map((column) => {
    if (!column.editable) {
      return column;
    }

    return {
      ...column,
      className: cn(column.className, "p-0"),
      render: (row, index) => {
        const rowKey = getRowKey(row);
        const active = editing?.rowKey === rowKey && editing.columnKey === column.key;
        const editable = typeof column.editable === "function" ? column.editable(row) : column.editable;

        if (!active) {
          return (
            <div className={cn("group/cell flex items-center gap-1", column.align === "right" && "justify-end")}>
              <span className={cn(column.numeric && "metric-tabular")}>{column.render(row, index)}</span>
              {editable ? (
                <button
                  type="button"
                  aria-label={`编辑 ${typeof column.header === "string" ? column.header : column.key}`}
                  onClick={() => {
                    setEditing({ rowKey, columnKey: column.key });
                    setDraft(column.value?.(row) ?? "");
                    setError(null);
                  }}
                  className="opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil aria-hidden className="h-3 w-3 text-muted hover:text-brand" />
                </button>
              ) : null}
            </div>
          );
        }

        return (
          <span className="block">
            <input
              autoFocus
              type={column.inputType ?? "text"}
              value={draft}
              aria-label={`${typeof column.header === "string" ? column.header : column.key} 新值`}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit(row, column);
                }
                if (event.key === "Escape") {
                  setEditing(null);
                  setError(null);
                }
              }}
              onBlur={() => {
                if (!error) {
                  void commit(row, column);
                }
              }}
              className="erp-field h-[var(--control-h-sm)] text-meta"
            />
            {error ? <span className="mt-1 block text-label text-danger-ink">{error}</span> : null}
          </span>
        );
      },
    };
  });

  return <DataTable {...rest} columns={merged} />;
}

/* ============================================================================
 * 5. GroupedDataTable —— 一行主体 + N 行明细：采购单、付款单、套装
 * ========================================================================== */

export interface TableGroup<T> {
  key: string;
  label: ReactNode;
  rows: T[];
  /** 组尾摘要，如「小计 12,400.00」 */
  summary?: ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
}

export interface GroupedDataTableProps<T> extends Omit<DataTableProps<T>, "rows"> {
  groups: TableGroup<T>[];
  /** 组内小计是否展开 */
  showSummary?: boolean;
}

const groupToneClass: Record<NonNullable<TableGroup<unknown>["tone"]>, string> = {
  default: "bg-surface-muted/70 text-foreground",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  success: "bg-success-soft text-success-ink",
};

export function GroupedDataTable<T>({
  groups,
  columns,
  getRowKey,
  showSummary = true,
  ariaLabel,
  maxHeight,
  className,
  empty,
}: GroupedDataTableProps<T>) {
  const columnCount = columns.length;
  const isEmpty = groups.every((group) => group.rows.length === 0);

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="thin-scrollbar overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table aria-label={ariaLabel} className={tableSkin}>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    thSkin,
                    column.align === "right" || column.numeric
                      ? "text-right"
                      : column.align === "center"
                        ? "text-center"
                        : "text-left",
                    column.headerClassName,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-12 text-center text-body text-muted">
                  {empty ?? "暂无数据"}
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className={cn("border-t border-border", groupToneClass[group.tone ?? "default"])}>
                    <td colSpan={columnCount} className="px-[var(--cell-px)] py-2 text-body font-semibold">
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr
                      key={getRowKey(row)}
                      style={{ height: "var(--row-h)" }}
                      className="border-t border-border/70 hover:bg-surface-muted/60"
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            tdSkin,
                            column.align === "right" || column.numeric
                              ? "text-right"
                              : column.align === "center"
                                ? "text-center"
                                : "text-left",
                            column.numeric && "metric-tabular",
                            column.className,
                          )}
                        >
                          {column.render(row, 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {showSummary && group.summary ? (
                    <tr className="border-t border-border bg-surface-sunken">
                      <td colSpan={columnCount} className="px-[var(--cell-px)] py-1.5 text-right text-meta text-muted">
                        {group.summary}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================================
 * 6. TaskDataTable —— 同步任务、后台作业、批处理
 * ========================================================================== */

export type TaskState = "queued" | "running" | "success" | "failed" | "canceled";

export const TASK_STATE_META: Record<TaskState, { label: string; className: string }> = {
  queued: { label: "排队中", className: "bg-surface-muted text-muted" },
  running: { label: "运行中", className: "bg-info-soft text-info-ink" },
  success: { label: "成功", className: "bg-success-soft text-success-ink" },
  failed: { label: "失败", className: "bg-danger-soft text-danger-ink" },
  canceled: { label: "已取消", className: "bg-surface-muted text-muted" },
};

/** 任务状态药丸，TaskDataTable 与独立列表共用 */
export function TaskStatePill({ state, label }: { state: TaskState; label?: string }) {
  const meta = TASK_STATE_META[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold", meta.className)}>
      {state === "running" ? <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> : null}
      {label ?? meta.label}
    </span>
  );
}

/** 任务进度条：done/total 由调用方算好传入，表格层不做除法以外的推断 */
export function TaskProgress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <span className="flex min-w-24 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <span
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="block h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="metric-tabular shrink-0 text-meta text-muted">{percent}%</span>
    </span>
  );
}

export interface TaskDataTableProps<T> extends DataTableProps<T> {
  /** 提供后在表格右上角显示「N 运行中 / M 失败」汇总 */
  stateOf?: (row: T) => TaskState;
}

export function TaskDataTable<T>({ stateOf, meta, maxHeight = "min(62vh,680px)", ...rest }: TaskDataTableProps<T>) {
  const summary = useMemo(() => {
    if (!stateOf) {
      return null;
    }

    let running = 0;
    let failed = 0;
    for (const row of rest.rows) {
      const state = stateOf(row);
      if (state === "running") running += 1;
      if (state === "failed") failed += 1;
    }

    return (
      <span className="flex items-center gap-3">
        {running > 0 ? <span className="text-info-ink">{running} 运行中</span> : null}
        {failed > 0 ? <span className="text-danger-ink">{failed} 失败</span> : null}
        {running === 0 && failed === 0 ? <span>全部完成</span> : null}
      </span>
    );
  }, [rest.rows, stateOf]);

  return <DataTable {...rest} density="compact" maxHeight={maxHeight} meta={summary ?? meta} />;
}

/* ============================================================================
 * 导出清单：业务页只允许从这里挑一种
 * ========================================================================== */

export const TABLE_KINDS = [
  { kind: "standard", label: "StandardDataTable", use: "默认列表：商品、订单、广告组" },
  { kind: "dense", label: "DenseDataTable", use: "长表：库存、库龄、对账明细" },
  { kind: "finance", label: "FinanceDataTable", use: "财务：凭证、往来、结算" },
  { kind: "editable", label: "EditableDataTable", use: "逐格编辑：盘点、单价调整" },
  { kind: "grouped", label: "GroupedDataTable", use: "一行多明细：采购单、付款单" },
  { kind: "task", label: "TaskDataTable", use: "作业：同步任务、批处理" },
] as const;
