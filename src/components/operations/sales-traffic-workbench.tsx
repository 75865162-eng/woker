"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { SyncSourceView } from "@/lib/amazon-sync/contracts";
import type { SalesRow } from "@/lib/amazon-sync/sales-query";
const endpoint = "/api/operations/sync-center";
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
function scopeHeaders() {
  const headers = new Headers({ "content-type": "application/json" });
  try { headers.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}").workspaceId || "default"); } catch { headers.set("x-workspace-id", "default"); }
  return headers;
}
type Result = { rows: SalesRow[]; pagination: { pageCount: number; total: number }; asOf: string };
type ExportState = { id: string; status: string; rowCount?: number; error?: string };
export function SalesTrafficWorkbench({ sources, canSync, canExport, taskId, onTask }: { sources: SyncSourceView[]; canSync: boolean; canExport: boolean; taskId?: string; onTask?: (id: string) => void }) {
  const [seller, setSeller] = useState(""), [site, setSite] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [keyword, setKeyword] = useState(""), [direction, setDirection] = useState("desc");
  const [source, setSource] = useState(""), [preset, setPreset] = useState("yesterday"), [syncFrom, setSyncFrom] = useState(""), [syncTo, setSyncTo] = useState("");
  const [page, setPage] = useState(1), [reload, setReload] = useState(0), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [job, setJob] = useState<ExportState | null>(null);
  const sequence = useRef(0), mutation = useRef(0);
  const filters = { sellerAccountId: seller, marketplaceId: site, from, to, keyword, direction, ...(taskId ? { taskId } : {}) };
  const queryKey = JSON.stringify(filters);
  useEffect(() => { const requests = sequence, mutations = mutation; const reset = () => { ++requests.current; ++mutations.current; setResult(null); setJob(null); setError(""); setNotice(""); setBusy(false); setPage(1); setSeller(""); setSite(""); setSource(""); setReload(v => v + 1); }; window.addEventListener(workspaceScopeChangedEventName, reset); return () => { ++requests.current; ++mutations.current; window.removeEventListener(workspaceScopeChangedEventName, reset); }; }, []);
  useEffect(() => {
    const n = ++sequence.current, controller = new AbortController(); setLoading(true); setResult(null); setError("");
    const params = new URLSearchParams({ section: "sales-traffic", page: String(page), ...JSON.parse(queryKey) });
    void fetch(`${endpoint}?${params}`, { headers: scopeHeaders(), cache: "no-store", signal: controller.signal }).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "销售流量读取失败。"); if (n === sequence.current) setResult(payload); }).catch(e => { if (n === sequence.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); }).finally(() => { if (n === sequence.current) setLoading(false); });
    return () => { controller.abort(); };
  }, [queryKey, page, reload]);
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return;
    let active = true;
    const timer = window.setInterval(() => { void fetch(`${endpoint}/exports?id=${encodeURIComponent(job.id)}`, { headers: scopeHeaders(), cache: "no-store" }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error ?? "导出状态读取失败。"); if (active) setJob(p); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "导出状态读取失败。"); }); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [job]);
  const requestSync = async () => {
    const n = ++mutation.current; setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(endpoint, { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ action: "run", sourceIds: [source], datePreset: preset, ...(preset === "custom" ? { dateFrom: syncFrom, dateTo: syncTo } : {}) }) });
      const p = await r.json(); if (!r.ok) throw new Error(p.error ?? "同步申请失败。");
      if (n === mutation.current) setNotice("日期与站点范围已冻结，等待另一位有审批权限的用户批准并应用；尚未请求 Amazon。");
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "同步申请失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const exportData = async () => {
    const n = ++mutation.current; setBusy(true); setError("");
    try {
      const r = await fetch(`${endpoint}/exports`, { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ filters, asOf: result?.asOf, idempotencyKey: crypto.randomUUID() }) }); const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? "导出申请失败。"); if (n === mutation.current) setJob(p);
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "导出失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const download = async () => {
    if (!job) return; const n = ++mutation.current; setBusy(true);
    try {
      const r = await fetch(`${endpoint}/exports?id=${encodeURIComponent(job.id)}&download=1`, { headers: scopeHeaders(), cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? "下载失败。");
      const blob = await r.blob(); if (n !== mutation.current) return;
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `amazon-sales-${job.id}.jsonl`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { if (n === mutation.current) setError(e instanceof Error ? e.message : "下载失败。"); }
    finally { if (n === mutation.current) setBusy(false); }
  };
  const select = (set: (s: string) => void, value: string) => { set(value); setPage(1); };
  return <div className="space-y-4" data-testid="sales-traffic-workbench">
    <p className="text-xs text-muted">店铺逐日汇总 · 日期为 Marketplace 报告业务日（含结束日） · 每日选择最新成功版本。SKU / ASIN 日销量不在本报告粒度内。</p>
    {!taskId && <form className="flex flex-wrap items-end gap-2 rounded border border-border p-3" onSubmit={e => { e.preventDefault(); void requestSync(); }}>
      <label className="grid gap-1 text-xs">同步来源<select aria-label="报告同步来源" className={input} value={source} onChange={e => setSource(e.target.value)} required><option value="">选择 Seller / Marketplace</option>{sources.filter(s => s.resource === "sales_traffic" && s.enabled).map(s => <option key={s.id} value={s.id}>{s.seller.displayName || s.seller.accountKey} / {s.marketplaceId}</option>)}</select></label>
      <label className="grid gap-1 text-xs">同步日期<select aria-label="同步日期" className={input} value={preset} onChange={e => setPreset(e.target.value)}>{[["today", "今天"], ["yesterday", "昨天"], ["last7", "最近 7 天"], ["last30", "最近 30 天"], ["thisMonth", "本月"], ["lastMonth", "上月"], ["custom", "自定义"]].map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></label>
      {preset === "custom" && <><label className="grid gap-1 text-xs">同步开始日期<input type="date" className={input} value={syncFrom} onChange={e => setSyncFrom(e.target.value)} required /></label><label className="grid gap-1 text-xs">同步结束日期<input type="date" className={input} value={syncTo} onChange={e => setSyncTo(e.target.value)} required /></label></>}
      <Button type="submit" size="sm" disabled={!canSync || busy || !source}>申请报告同步</Button>
      <p className="w-full text-xs text-muted">每次最多 31 天、历史最多 730 天。站点时区由后端确定；含今天的范围属于未闭合周期，仅保留质量证据，不发布为完整数据。</p>
    </form>}
    <div className="flex flex-wrap gap-2">
      <label className="grid gap-1 text-xs">Seller<select aria-label="日报 Seller" className={input} value={seller} onChange={e => select(setSeller, e.target.value)}><option value="">全部 Seller</option>{[...new Map(sources.filter(s => s.resource === "sales_traffic").map(s => [s.sellerAccountId, s.seller.displayName || s.seller.accountKey])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">Marketplace<select aria-label="日报 Marketplace" className={input} value={site} onChange={e => select(setSite, e.target.value)}><option value="">全部 Marketplace</option>{[...new Set(sources.filter(s => s.resource === "sales_traffic").map(s => s.marketplaceId))].map(id => <option key={id}>{id}</option>)}</select></label>
      <label className="grid gap-1 text-xs">业务开始日期<input className={input} type="date" value={from} onChange={e => select(setFrom, e.target.value)} /></label><label className="grid gap-1 text-xs">业务结束日期<input className={input} type="date" value={to} onChange={e => select(setTo, e.target.value)} /></label>
      <label className="grid gap-1 text-xs">店铺 / Seller / 站点搜索<input className={input} value={keyword} maxLength={200} onChange={e => select(setKeyword, e.target.value)} /></label>
      <label className="grid gap-1 text-xs">业务日期排序<select aria-label="业务日期排序" className={input} value={direction} onChange={e => select(setDirection, e.target.value)}><option value="desc">最新在前</option><option value="asc">最早在前</option></select></label>
      <Button size="sm" variant="secondary" disabled={loading || busy} onClick={() => setReload(v => v + 1)}>刷新日报</Button><Button size="sm" disabled={!canExport || busy || loading || !result} onClick={() => void exportData()}>按当前条件异步导出</Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-brand">{notice}</p>}
    {job && <p className="text-xs">导出 {job.id} · {job.status} · {job.rowCount ?? "—"} 条 {job.error}{job.status === "SUCCEEDED" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void download()}>下载 JSONL（含来源与版本）</Button>}</p>}
    {loading && <p role="status">读取已发布日报…</p>}
    {result && <><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr>{["业务日 / 来源", "销售额", "销量 / 订单商品数", "Sessions / Page views", "质量 / 数据版本"].map(v => <th className="py-2" key={v}>{v}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr className="border-t border-border" key={row.id}><td className="py-2">{row.businessDate}<span className="block text-muted">{row.sellerName} · {row.amazonSellerId} · {row.marketplaceId}</span></td><td>{row.metrics.orderedProductSales ? `${row.metrics.orderedProductSales.amount} ${row.metrics.orderedProductSales.currencyCode}` : "缺失"}</td><td>{row.metrics.unitsOrdered ?? "缺失"} / {row.metrics.totalOrderItems ?? "缺失"}</td><td>{row.metrics.sessions ?? "缺失"} / {row.metrics.pageViews ?? "缺失"}</td><td>{row.quality}<details><summary className="cursor-pointer text-brand">来源与版本</summary><p className="max-w-sm break-all">Reports 2021-06-30 · GET_SALES_AND_TRAFFIC_REPORT<br />报告 {row.reportId} · 文档 {row.documentId}<br />任务 / 版本 {row.syncRunId}<br />获取 {String(row.capturedAt)} · 发布 {String(row.publishedAt)}</p>{onTask && <Button size="sm" variant="secondary" onClick={() => onTask(row.syncRunId)}>查看来源任务</Button>}</details></td></tr>)}</tbody></table></div>{!result.rows.length && <p className="text-sm text-muted">没有符合条件的成功发布日报；这不代表销量为 0。</p>}<div className="flex items-center justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · {page} / {Math.max(1, result.pagination.pageCount)}</span><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>日报上一页</Button><Button size="sm" variant="secondary" disabled={page >= result.pagination.pageCount || loading} onClick={() => setPage(v => v + 1)}>日报下一页</Button></div></>}
  </div>;
}
