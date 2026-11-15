"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const scopeKey = "tiaotiao.workspace.scope";

function workspaceId() {
  try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; }
  catch { return "default"; }
}

export function extHeaders(json = false) {
  const result = new Headers({ "x-workspace-id": workspaceId() });
  if (json) result.set("content-type", "application/json");
  return result;
}

export async function extPost(action: string, body: Record<string, unknown>) {
  const response = await fetch("/api/operations/ext", {
    method: "POST", headers: extHeaders(true), body: JSON.stringify({ action, ...body }),
  });
  const data = await response.json() as { data?: unknown; result?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error ?? "操作失败。");
  return data;
}

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
      const response = await fetch(`/api/operations/ext?${search}`, { headers: extHeaders(), cache: "no-store" });
      const payload = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "读取失败。");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败。");
    } finally { setLoading(false); }
  }, [search, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const inputCls = "h-9 w-full min-w-0 rounded border border-border bg-background px-2 text-sm";
export const areaCls = "min-h-20 w-full min-w-0 rounded border border-border bg-background px-2 py-1.5 text-sm";
export const today = () => new Date().toISOString().slice(0, 10);

export function Field(props: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return <label className="grid min-w-0 gap-1 text-xs">
    <span className="text-muted">{props.label}</span>
    <input className={inputCls} type={props.type ?? "text"} value={props.value} placeholder={props.placeholder} onChange={event => props.onChange(event.target.value)} />
    {props.hint && <span className="text-[11px] text-muted">{props.hint}</span>}
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
    {error ? <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
    {notice ? <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p> : null}
  </>;
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{text}</p>;
}

export type Column<T> = { key: string; label: string; align?: "right"; render?: (row: T) => React.ReactNode; className?: string };

export function Table<T extends { id?: string }>(props: { columns: Array<Column<T>>; rows: T[]; empty: string; rowKey?: (row: T, index: number) => string }) {
  if (!props.rows.length) return <Empty text={props.empty} />;
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[680px] text-left text-xs">
      <thead className="text-muted"><tr>{props.columns.map(column => <th key={column.key} className={`pb-1 font-medium ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>)}</tr></thead>
      <tbody>{props.rows.map((row, index) => <tr key={props.rowKey ? props.rowKey(row, index) : (row.id ?? index)} className="border-t border-border align-top">
        {props.columns.map(column => <td key={column.key} className={`py-1.5 ${column.align === "right" ? "text-right tabular-nums" : ""} ${column.className ?? ""}`}>
          {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? "—")}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function Kpis({ items }: { items: Array<{ label: string; value: string; hint?: string; tone?: "warn" | "good" }> }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
    {items.map(item => <article key={item.label} className="rounded border border-border bg-surface px-3 py-2">
      <p className="text-[10px] text-muted">{item.label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${item.tone === "warn" ? "text-red-700" : item.tone === "good" ? "text-emerald-700" : ""}`}>{item.value}</p>
      {item.hint && <p className="text-[10px] text-muted">{item.hint}</p>}
    </article>)}
  </div>;
}

export function Badge({ text, tone }: { text: string; tone?: "warn" | "good" | "muted" | "info" }) {
  const cls = tone === "warn" ? "border-red-200 bg-red-50 text-red-800"
    : tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "info" ? "border-sky-200 bg-sky-50 text-sky-800"
        : "border-border bg-background text-muted";
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{text}</span>;
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
