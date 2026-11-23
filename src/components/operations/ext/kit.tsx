"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTabActive } from "@/components/app-shell/tab-activity";
import { readWorkspaceApiQuery } from "@/lib/workspace/workspace-api-cache";
import { fetchExtQuery } from "@/lib/workspace/ext-query";
import { extHeaders } from "@/lib/workspace/ext-headers";

export { extHeaders };

export async function extPost(action: string, body: Record<string, unknown>) {
  const response = await fetch("/api/operations/ext", {
    method: "POST", headers: extHeaders(true), body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json() as { data?: unknown; result?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error ?? "操作失败。");
  return data;
}

/** 缓存新鲜期：这段时间内直接用手上的数据，不再补一次网络校验。 */
const FRESH_WINDOW_MS = 5000;

/** 通用读取钩子：kind 变化自动重取，返回值形状由调用方声明。 */
export function useExt<T>(kind: string, query: Record<string, string> = {}, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const search = useMemo(() => new URLSearchParams({ kind, ...query }).toString(), [kind, JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setError("");
    try {
      setData(await fetchExtQuery<T>(search));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败。");
    } finally { setLoading(false); }
  }, [search, enabled]);
  // 先用上次的结果把内容画出来，再后台校验：切回标签不会闪空。
  // 刚取回来不久（悬停预取刚写完缓存）就跳过这次校验，省掉一次完全重复的往返。
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const cached = readWorkspaceApiQuery<T>(search);
    if (cached) {
      setData(cached.data);
      setLoading(false);
      if (Date.now() - cached.cachedAt < FRESH_WINDOW_MS) return;
    }
    void load();
  }, [load, enabled, search]);
  return { data, error, loading, reload: load };
}

export const inputCls = "h-9 w-full min-w-0 rounded border border-border bg-background px-2 text-sm";
export const areaCls = "min-h-20 w-full min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm";
export const today = () => new Date().toISOString().slice(0, 10);

export function Field(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return <label className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{props.label}</span>
    <input className={inputCls} type={props.type ?? "text"} value={props.value} placeholder={props.placeholder} onChange={event => props.onChange(event.target.value)} />
    {props.hint && <span className="text-label text-muted">{props.hint}</span>}
  </label>;
}

export function SelectField(props: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return <label className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{props.label}</span>
    <select className={inputCls} value={props.value} onChange={event => props.onChange(event.target.value)}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

export function AreaField(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{props.label}</span>
    <textarea className={areaCls} value={props.value} placeholder={props.placeholder} onChange={event => props.onChange(event.target.value)} />
  </label>;
}

export function Section(props: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <section className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold">{props.title}</h2>
        {props.description && <p className="mt-0.5 text-xs text-muted">{props.description}</p>}
      </div>
      {props.actions}
    </div>
    {props.children}
  </section>;
}

export function Notice({ error, notice }: { error?: string; notice?: string }) {
  return <>
    {error ? <p role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
    {notice ? <p className="rounded border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-ink">{notice}</p> : null}
  </>;
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{text}</p>;
}

export type Column<T> = { key: string; label: string; align?: "right"; render?: (row: T) => React.ReactNode; className?: string };

/** 每批渲染的行数：长列表只挂载可视区附近的行，避免一次塞进上千个 DOM 节点。 */
const ROW_CHUNK = 80;

/** 行数不超过这个值的表格在标签转后台时保留 DOM：重建它的开销比省下的节点更贵。 */
const KEEP_DOM_ROWS = 300;

export function Table<T extends { id?: string }>(props: {
  columns: Array<Column<T>>;
  rows: T[];
  empty: string;
  rowKey?: (row: T, index: number) => string;
  /** 可选首列复选框：不传则不渲染，其他调用方零影响。 */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (id: string, checked: boolean) => void;
  onToggleAll?: (ids: string[], checked: boolean) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const active = useTabActive();
  const total = props.rows.length;
  const rowId = (row: T, index: number) => props.rowKey ? props.rowKey(row, index) : String(row.id ?? index);

  useEffect(() => { setVisibleCount(ROW_CHUNK); }, [total]);

  useEffect(() => {
    if (!active) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((current) => Math.min(total, current + ROW_CHUNK));
      }
    }, { rootMargin: "300px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [total, visibleCount, active]);

  if (!total) return <Empty text={props.empty} />;
  // 标签转入后台时，只有「大表」才释放行级 DOM：几千行的表格常驻会让每个标签都占着
  // 上千个节点。行数不多的表格留在树里更划算——切回来只是一次 display 切换，
  // 不用重新挂载表格、也不用重算滚动锚点。
  if (!active && total > KEEP_DOM_ROWS) return null;
  const shown = total > visibleCount ? props.rows.slice(0, visibleCount) : props.rows;

  const colCount = props.columns.length + (props.selectable ? 1 : 0);
  const shownIds = shown.map((row, index) => rowId(row, index));
  const selected = props.selectedIds ?? new Set<string>();
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selected.has(id));
  const someShownSelected = shownIds.some(id => selected.has(id));
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[680px] text-left text-xs">
      <thead className="text-muted"><tr>
        {props.selectable ? <th className="w-8 pb-1"><input type="checkbox" aria-label="全选当前页" checked={allShownSelected} ref={node => { if (node) node.indeterminate = !allShownSelected && someShownSelected; }} onChange={event => props.onToggleAll?.(shownIds, event.target.checked)} /></th> : null}
        {props.columns.map(column => <th key={column.key} className={`pb-1 font-medium ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>)}
      </tr></thead>
      <tbody>{shown.map((row, index) => {
        const id = rowId(row, index);
        return <tr key={id} className="border-t border-border align-top">
          {props.selectable ? <td className="py-1.5"><input type="checkbox" aria-label={`选择评论 ${id}`} checked={selected.has(id)} onChange={event => props.onToggle?.(id, event.target.checked)} /></td> : null}
          {props.columns.map(column => <td key={column.key} className={`py-1.5 ${column.align === "right" ? "text-right tabular-nums" : ""} ${column.className ?? ""}`}>
            {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? "—")}
          </td>)}
        </tr>;
      })}
      {total > visibleCount ? <tr ref={sentinelRef}>
        <td colSpan={colCount} className="py-2 text-center text-label text-muted">已显示 {shown.length} / {total} 行，继续滚动加载</td>
      </tr> : null}</tbody>
    </table>
  </div>;
}

export function Kpis({ items }: { items: Array<{ label: string; value: string; hint?: React.ReactNode; tone?: "warn" | "good" | "muted" }> }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
    {items.map(item => <article key={item.label} className="rounded border border-border bg-surface px-3 py-2">
      <p className="text-label text-muted">{item.label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${item.tone === "warn" ? "text-danger-ink" : item.tone === "good" ? "text-success-ink" : item.tone === "muted" ? "text-muted" : ""}`}>{item.value}</p>
      {item.hint && <div className="flex flex-wrap items-center gap-2 text-label text-muted">{item.hint}</div>}
    </article>)}
  </div>;
}

export function Badge({ text, tone }: { text: string; tone?: "warn" | "good" | "muted" | "info" }) {
  const cls = tone === "warn" ? "border-danger/30 bg-danger-soft text-danger-ink"
    : tone === "good" ? "border-success/30 bg-success-soft text-success-ink"
      : tone === "info" ? "border-info/30 bg-info-soft text-info-ink"
        : "border-border bg-background text-muted";
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-label ${cls}`}>{text}</span>;
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string; count?: number }>; value: string; onChange: (id: string) => void }) {
  return <div className="flex flex-wrap gap-1 border-b border-border pb-1">
    {tabs.map(tab => <button key={tab.id} type="button" onClick={() => onChange(tab.id)}
      className={`rounded px-2.5 py-1 text-xs ${value === tab.id ? "bg-brand text-white" : "text-muted hover:bg-surface"}`}>
      {tab.label}{tab.count === undefined ? "" : ` (${tab.count})`}
    </button>)}
  </div>;
}

export function SubmitRow({ busy, children, onCancel }: { busy: boolean; children: React.ReactNode; onCancel?: () => void }) {
  return <div className="flex items-end gap-2">
    <Button size="sm" disabled={busy}>{children}</Button>
    {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}>取消</Button>}
  </div>;
}

export const money = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
};

export const bp = (value: unknown) => `${(Number(value ?? 0) / 100).toFixed(2)}%`;

export const statusLabels: Record<string, string> = {
  DRAFT: "草稿", SUBMITTED: "已提交", APPROVED: "已批准", REJECTED: "已驳回", PAID: "已付款",
  SHIPPED: "已发货", DELIVERED: "已签收", CANCELLED: "已取消", CLOSED: "已关闭",
  PENDING: "待处理", APPLIED: "已采纳", DISMISSED: "已忽略",
  NEW: "待处理", REPLIED: "已回复", IGNORED: "已忽略",
  ACTIVE: "生效中", SUSPENDED: "已暂停", EXPIRED: "已过期", SELECTED: "已选定",
  OPEN: "待申报", FILED: "已申报", VOID: "已作废",
  WINNING: "持购物车", LOSING: "丢购物车", UNKNOWN: "未知",
  POSITIVE: "好评", NEUTRAL: "中评", NEGATIVE: "差评",
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;
