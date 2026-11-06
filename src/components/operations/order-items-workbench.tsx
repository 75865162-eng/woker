"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Result = {
  sources: Array<{ id: string; marketplaceId: string; detailsEnabled: boolean; detailsComplete: boolean }>;
  rows: Array<{ amazonOrderId: string; sourceId: string; sourceRunId: string; sellerAccountId: string; marketplaceId: string; createdTime: string; sourceUpdatedAt: string; rawStatus: string | null; capturedAt: string; detailsUpdatedAt: string | null; items: Array<{ orderItemId: string; asin: string | null; sellerSku: string | null; quantityOrdered: number; proceedsOriginal: string | null; currencyCode: string | null }> }>;
  pagination: { total: number; pageCount: number };
};
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
const columns = [["order", "订单"], ["marketplace", "Marketplace"], ["sku", "SKU"], ["asin", "ASIN"], ["quantity", "数量"], ["price", "商品金额"], ["status", "订单状态"], ["created", "订单创建"], ["updated", "订单更新时间"], ["source", "来源 / 同步"]] as const;
export function OrderItemsWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders, onTask }: { sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers; onTask: (id: string) => void }) {
  const [orderId, setOrderId] = useState(""), [sellerSku, setSellerSku] = useState(""), [asin, setAsin] = useState(""), [status, setStatus] = useState(""), [dateField, setDateField] = useState("createdTime"), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [visible, setVisible] = useState<string[]>(columns.map(c => c[0]));
  const [result, setResult] = useState<Result | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => { try { const value = JSON.parse(localStorage.getItem("amazon-order-item-columns-v1") ?? "null"); if (Array.isArray(value)) setVisible(value.filter(v => columns.some(c => c[0] === v))); } catch { /* use defaults */ } }, []);
  const toggleColumn = (id: string) => setVisible(current => { const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]; localStorage.setItem("amazon-order-item-columns-v1", JSON.stringify(next)); return next; });
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    const params = new URLSearchParams({ section: "orders", sellerAccountId, marketplaceId, amazonOrderId: orderId, sellerSku, asin, rawStatus: status, dateField, from, to, page: String(page) });
    void fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store" }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "订单商品读取失败。"); if (active) setResult(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "订单商品读取失败。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sellerAccountId, marketplaceId, orderId, sellerSku, asin, status, dateField, from, to, page, refresh, getHeaders]);
  const visibleSet = useMemo(() => new Set(visible), [visible]);
  const cell = (id: string, row: Result["rows"][number], item: Result["rows"][number]["items"][number]) => {
    if (id === "order") return row.amazonOrderId;
    if (id === "marketplace") return row.marketplaceId;
    if (id === "sku") return item.sellerSku ?? "—";
    if (id === "asin") return item.asin ?? "—";
    if (id === "quantity") return String(item.quantityOrdered);
    if (id === "price") return item.proceedsOriginal == null ? "—" : `${item.proceedsOriginal} ${item.currencyCode ?? ""}`;
    if (id === "status") return row.rawStatus ?? "未返回";
    if (id === "created") return new Date(row.createdTime).toISOString();
    if (id === "updated") return new Date(row.sourceUpdatedAt).toISOString();
    return <Button size="sm" variant="secondary" onClick={() => onTask(row.sourceRunId)}>任务 {row.sourceRunId.slice(0, 8)}</Button>;
  };
  return <div className="space-y-3" data-testid="amazon-order-items-workbench">
    <p className="text-xs text-muted">订单商品来自 Orders 2026-01-01 getOrder.orderItems；筛选日期可明确选择订单创建时间或 Amazon 更新时间。无详情的订单不会被推测为无商品。</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">订单 ID<input className={input} value={orderId} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">SKU<input className={input} value={sellerSku} onChange={e => { setSellerSku(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">ASIN<input className={input} value={asin} onChange={e => { setAsin(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">状态<input className={input} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">日期含义<select className={input} value={dateField} onChange={e => { setDateField(e.target.value); setPage(1); }}><option value="createdTime">订单创建时间（UTC）</option><option value="sourceUpdatedAt">订单更新时间（UTC）</option></select></label>
      <label className="grid gap-1 text-xs">从<input type="date" className={input} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label className="grid gap-1 text-xs">至（含当日）<input type="date" className={input} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新</Button>
    </div>
    <details className="text-xs"><summary className="cursor-pointer">列设置</summary><div className="mt-2 flex flex-wrap gap-3">{columns.map(([id, name]) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={visibleSet.has(id)} onChange={() => toggleColumn(id)} />{name}</label>)}</div></details>
    {loading && <p role="status" className="text-sm text-muted">读取订单与商品明细…</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr>{columns.filter(([id]) => visibleSet.has(id)).map(([, name]) => <th key={name} className="py-2 pr-3 font-medium">{name}</th>)}</tr></thead><tbody>{result.rows.flatMap(row => row.items.map(item => <tr key={`${row.sourceId}:${row.amazonOrderId}:${item.orderItemId}`} className="border-t border-border">{columns.filter(([id]) => visibleSet.has(id)).map(([id]) => <td key={id} className="py-2 pr-3">{cell(id, row, item)}</td>)}</tr>))}</tbody></table></div>
      {!result.rows.some(row => row.items.length) && <p className="py-6 text-center text-sm text-muted">{result.sources.some(source => source.detailsEnabled) ? "当前页没有已补齐的订单商品；详情采集已启用，请查看订单任务进度或翻页。" : "订单商品详情采集尚未启用，当前仅同步基础订单；需要启用订单详情策略后补齐，无需上传订单文件。"}</p>}
      <div className="flex justify-end gap-3 text-xs text-muted"><span>{result.pagination.total} 个订单 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(v => v - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={loading || page >= result.pagination.pageCount} onClick={() => setPage(v => v + 1)}>下一页</Button></div></>}
  </div>;
}
