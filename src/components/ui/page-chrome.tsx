"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * 页面骨架件。
 *
 * 一条硬规则：壳层顶栏已经渲染了页面名（h1），所以列表页的 PageHeader
 * **不再重复标题**，只承载「面包屑 + 页面级操作 + 状态 + 已选条件」。
 * 只有详情页需要区分「当前记录」时，才用 title（h2 语义）。
 */

/* ------------------------------------------------------------- Breadcrumb */

export function Breadcrumb({ items, className }: { items: { label: string; href?: string }[]; className?: string }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="面包屑" className={cn("flex items-center gap-1 text-meta text-muted", className)}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight aria-hidden className="h-3 w-3 text-border-strong" /> : null}
            {item.href && !last ? (
              <a href={item.href} className="rounded-sm hover:text-brand hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current={last ? "page" : undefined} className={last ? "text-foreground" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------- PageHeader */

export function PageHeader({
  title,
  description,
  status,
  actions,
  secondaryActions,
  breadcrumb,
  onBack,
  meta,
  className,
}: {
  /** 仅详情页使用；列表页留空，避免与壳层标题重复 */
  title?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  onBack?: () => void;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {breadcrumb ? <Breadcrumb items={breadcrumb} className="mb-1" /> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {onBack ? (
            <Button type="button" size="sm" variant="ghost" onClick={onBack} aria-label="返回上一页" className="-ml-1 px-1.5">
              <ChevronRight aria-hidden className="h-3.5 w-3.5 rotate-180" />
              返回
            </Button>
          ) : null}
          {title ? <h2 className="min-w-0 truncate text-title text-foreground">{title}</h2> : null}
          {status}
          {meta ? <span className="text-meta text-muted">{meta}</span> : null}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-meta text-muted">{description}</p> : null}
      </div>
      {actions || secondaryActions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {secondaryActions}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
  ariaLabel = "页面分区",
}: {
  value: T;
  items: { key: T; label: ReactNode; count?: number; disabled?: boolean }[];
  onChange: (key: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex items-center gap-1 border-b border-border", className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              "-mb-px inline-flex h-8 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-brand font-semibold text-brand"
                : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "metric-tabular rounded-full px-1.5 text-label",
                  active ? "bg-brand/10 text-brand" : "bg-surface-muted text-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- FilterBar */

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove?: () => void;
}

export function FilterBar({
  children,
  activeFilters,
  onReset,
  resultSummary,
  className,
  actions,
}: {
  children?: ReactNode;
  /** 已选条件，逐个可移除 —— 任务书 ListPage 明确要求 */
  activeFilters?: ActiveFilter[];
  onReset?: () => void;
  resultSummary?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const hasFilters = Boolean(activeFilters && activeFilters.length > 0);

  return (
    <div className={cn("rounded-lg border border-border bg-surface", className)}>
      <div className="flex flex-wrap items-end gap-2 px-4 py-2.5">
        {children}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {onReset && hasFilters ? (
            <Button type="button" size="sm" variant="ghost" onClick={onReset}>
              <RotateCcw aria-hidden className="h-3 w-3" />
              重置
            </Button>
          ) : null}
        </div>
      </div>
      {hasFilters || resultSummary ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-surface-sunken px-4 py-1.5">
          {resultSummary ? <span className="mr-1 text-meta text-muted">{resultSummary}</span> : null}
          {activeFilters?.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-meta text-foreground"
            >
              {filter.label}
              {filter.onRemove ? (
                <button
                  type="button"
                  aria-label={`移除筛选 ${filter.label}`}
                  onClick={filter.onRemove}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  <X aria-hidden className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- Pagination */

export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100, 200],
  note,
  className,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  note?: ReactNode;
  className?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  // 最多显示 7 个页码位，中间用省略号
  const pages: (number | "gap")[] = [];
  if (pageCount <= 7) {
    for (let index = 1; index <= pageCount; index += 1) {
      pages.push(index);
    }
  } else {
    pages.push(1);
    if (current > 3) pages.push("gap");
    for (let index = Math.max(2, current - 1); index <= Math.min(pageCount - 1, current + 1); index += 1) {
      pages.push(index);
    }
    if (current < pageCount - 2) pages.push("gap");
    pages.push(pageCount);
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-3 text-meta text-muted">
        <span className="metric-tabular">
          {note ? `${note} · ` : ""}
          共 {total.toLocaleString("zh-CN")} 条{total > 0 ? `，当前 ${from}–${to}` : ""}
        </span>
        {onPageSizeChange ? (
          <label className="flex items-center gap-1">
            每页
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label="每页条数"
              className="h-[var(--control-h-sm)] rounded-md border border-border bg-surface px-1.5 text-meta text-foreground"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="secondary" disabled={current <= 1} onClick={() => onPage(current - 1)}>
          上一页
        </Button>
        {pages.map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-meta text-muted">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === current ? "page" : undefined}
              onClick={() => onPage(item)}
              className={cn(
                "h-[var(--control-h-sm)] min-w-[var(--control-h-sm)] rounded-md px-1.5 text-meta transition-colors",
                item === current
                  ? "bg-brand font-semibold text-white"
                  : "text-foreground hover:bg-surface-muted",
              )}
            >
              {item}
            </button>
          ),
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={current >= pageCount}
          onClick={() => onPage(current + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- LoadingState / ErrorState */

export function LoadingState({ label = "加载中…", rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-border bg-surface p-4">
      <span className="mb-3 flex items-center gap-2 text-meta text-muted">
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        {label}
      </span>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="h-8 animate-pulse rounded-md bg-surface-muted"
            style={{ opacity: 1 - index * 0.12 }}
          />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  message,
  onRetry,
  detail,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  detail?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-6 text-center">
      <AlertTriangle aria-hidden className="mx-auto h-5 w-5 text-danger" />
      <p className="mt-2 text-section text-danger-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-meta text-danger-ink/90">{message}</p>
      {detail ? <div className="mt-2 text-label text-danger-ink/80">{detail}</div> : null}
      {onRetry ? (
        <Button type="button" size="sm" variant="secondary" onClick={onRetry} className="mt-3">
          <RotateCcw aria-hidden className="h-3 w-3" />
          重试
        </Button>
      ) : null}
    </div>
  );
}
