"use client";

import { useEffect, type ReactNode } from "react";
import { Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * 六种标准页面模板。
 *
 * 模板只负责「骨架与节奏」，不碰业务数据：
 * 页面之间的一致性是靠骨架保证的，业务差异留在 children 里。
 *
 * 排版节奏统一为：24px 页面留白 → 16px 区块间距 → 16px 卡片内距。
 */

/* --------------------------------------------------------------- 1. ListPage */

export function ListPageTemplate({
  header,
  stats,
  filters,
  table,
  batchBar,
  pagination,
  aside,
  className,
}: {
  /** 由 PageHeader 渲染：面包屑 + 页面级操作 + 已选条件入口 */
  header?: ReactNode;
  stats?: ReactNode;
  filters?: ReactNode;
  table: ReactNode;
  /** 选中行后浮现的批量操作条 */
  batchBar?: ReactNode;
  pagination?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {header}
      {stats}
      {filters}
      <div className={cn("min-w-0", aside && "grid grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="flex min-w-0 flex-col gap-0">
          {batchBar ? <div className="mb-2">{batchBar}</div> : null}
          {table}
          {pagination ? <div className="mt-2">{pagination}</div> : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 2. DetailPage */

export function DetailPageTemplate({
  header,
  tabs,
  children,
  aside,
  asideTitle = "关联信息",
  className,
}: {
  header: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  asideTitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {header}
      {tabs}
      <div className={cn("min-w-0", aside && "grid grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="flex min-w-0 flex-col gap-[var(--gap-section)]">{children}</div>
        {aside ? (
          <aside className="flex min-w-0 flex-col gap-[var(--gap-section)]">
            {asideTitle ? <p className="text-section text-foreground">{asideTitle}</p> : null}
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** 详情分组：标题 + 键值对网格，避免每个页面自己写 <dl> 样式 */
export function DetailGroup({
  title,
  description,
  actions,
  children,
  columns = 3,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-section text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div
        className={cn(
          "grid gap-x-4 gap-y-3 px-4 py-3",
          columns === 2 && "grid-cols-1 md:grid-cols-2",
          columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
          columns === 4 && "grid-cols-2 xl:grid-cols-4",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function DetailItem({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-meta text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-foreground">{value ?? "—"}</dd>
      {hint ? <p className="mt-0.5 text-label text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------- 3. WorkbenchPage */

export function WorkbenchPageTemplate({
  context,
  kpis,
  main,
  aside,
  asideTitle = "AI 与审批",
  className,
}: {
  /** 上下文选择：店铺 / 站点 / 广告账户 / 时间范围 */
  context?: ReactNode;
  kpis?: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
  asideTitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {context}
      {kpis}
      <div className={cn("min-w-0", aside && "grid grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="flex min-w-0 flex-col gap-[var(--gap-section)]">{main}</div>
        {aside ? (
          <aside className="flex min-w-0 flex-col gap-[var(--gap-section)]">
            {asideTitle ? <p className="text-section text-foreground">{asideTitle}</p> : null}
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- 4. DashboardPage */

export function DashboardPageTemplate({
  kpis,
  charts,
  exceptions,
  shortcuts,
  className,
}: {
  kpis?: ReactNode;
  charts?: ReactNode;
  exceptions?: ReactNode;
  shortcuts?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {kpis}
      {exceptions}
      {charts}
      {shortcuts}
    </div>
  );
}

/** 图表容器：固定比例，避免不同页面图表高低不齐 */
export function ChartPanel({
  title,
  description,
  actions,
  children,
  height = 260,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  height?: number;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-section text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-meta text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 py-3" style={{ minHeight: height }}>
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- 5. FormPage */

export function FormPageTemplate({
  header,
  children,
  actions,
  dirty = false,
  saving = false,
  saveLabel = "保存",
  cancelLabel = "取消",
  onSave,
  onCancel,
  onDirtyBlock,
  sticky = true,
  className,
}: {
  header?: ReactNode;
  children: ReactNode;
  /** 额外操作，放在保存按钮左侧 */
  actions?: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  onSave?: () => void;
  onCancel?: () => void;
  /** 有未保存改动时离开页面的提示回调；返回 false 可阻止离开 */
  onDirtyBlock?: () => boolean;
  sticky?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!dirty) {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      if (onDirtyBlock && onDirtyBlock() === false) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, onDirtyBlock]);

  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {header}
      {dirty ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-meta text-warning-ink"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
          有未保存的修改，离开前请先保存。
        </div>
      ) : null}
      <div className="flex flex-col gap-[var(--gap-section)]">{children}</div>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5",
          sticky && "sticky bottom-0 z-[var(--z-sticky)] shadow-2",
        )}
      >
        <span className="text-meta text-muted">{dirty ? "未保存" : "已保存"}</span>
        <div className="flex items-center gap-2">
          {actions}
          {onCancel ? (
            <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
              <X aria-hidden className="h-3 w-3" />
              {cancelLabel}
            </Button>
          ) : null}
          {onSave ? (
            <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
              <Save aria-hidden className="h-3 w-3" />
              {saving ? "保存中…" : saveLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- 6. ConsolePage */

export function ConsolePageTemplate({
  health,
  stats,
  tasks,
  logs,
  freshness,
  aside,
  className,
}: {
  /** 顶部运行状态条：服务、队列、上次同步 */
  health?: ReactNode;
  stats?: ReactNode;
  tasks?: ReactNode;
  logs?: ReactNode;
  freshness?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--gap-section)]", className)}>
      {health}
      {stats}
      <div className={cn("min-w-0", aside && "grid grid-cols-1 gap-[var(--gap-section)] xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="flex min-w-0 flex-col gap-[var(--gap-section)]">
          {tasks}
          {logs}
        </div>
        {aside ? (
          <div className="flex min-w-0 flex-col gap-[var(--gap-section)]">
            {freshness}
            {aside}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 运行状态灯：服务健康度一行三个 */
export function HealthIndicator({
  items,
}: {
  items: { key: string; label: ReactNode; state: "ok" | "warn" | "down"; detail?: ReactNode }[];
}) {
  const tone: Record<"ok" | "warn" | "down", { dot: string; text: string; label: string }> = {
    ok: { dot: "bg-success", text: "text-success-ink", label: "正常" },
    warn: { dot: "bg-accent", text: "text-warning-ink", label: "注意" },
    down: { dot: "bg-danger", text: "text-danger-ink", label: "异常" },
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5">
      {items.map((item) => {
        const theme = tone[item.state];
        return (
          <span key={item.key} className="flex items-center gap-2">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", theme.dot)} />
            <span className="text-meta text-muted">{item.label}</span>
            <span className={cn("text-meta font-semibold", theme.text)}>{theme.label}</span>
            {item.detail ? <span className="text-label text-muted">{item.detail}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
