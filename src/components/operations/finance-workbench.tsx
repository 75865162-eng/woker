"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { BusinessRecordFields } from "./business-record-fields";

type FinanceResult = {
  rows: Array<{ transactionId: string; sourceId: string; sellerAccountId: string; capturedAt: string; fxEvidence: Record<string, unknown> | null; sourceRunId: string; marketplaceId: string; postedAt: string; transactionType: string | null; rawStatus: string | null; orderId: string | null; classification: string; originalAmount: string; currency: string; convertedAmount: string | null; convertedCurrency: string | null; conversionStatus: string; marketplaceTimeZone: string }>;
  pagination: { total: number; pageCount: number };
  quarantinedCount: number; unconvertedCount: number;
  sources: Array<{ id: string; seller: { displayName: string }; resourceCursor: { watermarkFrom: string; watermarkTo: string; status: string } | null }>;
};
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
export function FinanceWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders, onTask }: { onTask?: (id: string) => void; sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers }) {
  const [currency, setCurrency] = useState(""), [orderId, setOrderId] = useState(""), [classification, setClassification] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [sourceRunId, setSourceRunId] = useState(""), [dateMode, setDateMode] = useState("day"), [fromTimestamp, setFromTimestamp] = useState(""), [toTimestamp, setToTimestamp] = useState("");
  const [selected, setSelected] = useState<FinanceResult["rows"][number] | null>(null);
  const [rawStatus, setRawStatus] = useState("");
  const [result, setResult] = useState<FinanceResult | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setSelected(null); setLoading(true); setResult(null); setError("");
    void (async () => {
      try {
        const params = new URLSearchParams({ section: "finance", sellerAccountId, marketplaceId, currency, orderId, classification, rawStatus, sourceRunId, ...(dateMode === "day" ? { from, to } : { fromTimestamp, toTimestamp }), page: String(page) });
        const response = await fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store", signal: controller.signal });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "财务读取失败。");
        if (!controller.signal.aborted) setResult(value);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "财务读取失败。"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [sellerAccountId, marketplaceId, currency, orderId, classification, rawStatus, from, to, sourceRunId, dateMode, fromTimestamp, toTimestamp, page, refresh, getHeaders]);
  return <div className="space-y-3" data-testid="amazon-finance-workbench">
    <p className="text-xs leading-relaxed text-muted">财务交易 · Finances 2024-06-19。卖家级采集、按实际站点查询，读取继承当前用户的账号分配。已提交窗口不代表最终结算，延迟入账和递延交易仍需复核。金额保留原币精度，不跨币种合计。来源批次为首次入库或最近业务更新批次，幂等复用保留原批次；查询到记录不代表其历史窗口已完整发布。</p>
    <div className="flex flex-wrap items-end gap-2 rounded border border-border bg-surface-muted p-3">
      <label className="grid gap-1 text-xs">币种<input className={input} value={currency} maxLength={3} onChange={e => { setCurrency(e.target.value.toUpperCase()); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">关联订单<input className={input} value={orderId} maxLength={200} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">交易分类<select className={input} value={classification} onChange={e => { setClassification(e.target.value); setPage(1); }}><option value="">全部</option><option value="ORDER_RELATED">订单关联</option><option value="NON_ORDER">非订单交易</option></select></label>
      <label className="grid gap-1 text-xs">原始状态<input className={input} value={rawStatus} maxLength={200} onChange={e => { setRawStatus(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">来源批次<input className={input} value={sourceRunId} maxLength={200} onChange={e => { setSourceRunId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">时间范围<select className={input} aria-label="时间范围" value={dateMode} onChange={e => { setDateMode(e.target.value); setPage(1); }}><option value="day">按 UTC 日期</option><option value="exact">精确 UTC 窗口</option></select></label>
      {dateMode === "day" ? <><label className="grid gap-1 text-xs">入账从（UTC）<input className={input} type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">入账至（含当日）<input className={input} type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></> : <>
      <label className="grid gap-1 text-xs">入账起点（UTC，含）<input className={input} value={fromTimestamp} placeholder="2025-07-04T09:31:07.189Z" onChange={e => { setFromTimestamp(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">入账终点（UTC，不含）<input className={input} value={toTimestamp} placeholder="2025-08-03T09:31:07.189Z" onChange={e => { setToTimestamp(e.target.value); setPage(1); }} /></label>
      </>}
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => { setCurrency(""); setOrderId(""); setClassification(""); setRawStatus(""); setSourceRunId(""); setDateMode("day"); setFrom(""); setTo(""); setFromTimestamp(""); setToTimestamp(""); setPage(1); }}>重置筛选</Button>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新财务</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted">读取已落库交易…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <p className="text-xs text-muted">本范围未折算 {result.unconvertedCount} 条；所选采集源／卖家下待归属隔离 {result.quarantinedCount} 条（不按站点、币种过滤，不计入下表）。</p>
      {result.sources.map(s => <p key={s.id} className="break-all text-xs text-muted">{s.seller.displayName} · {s.resourceCursor ? `${s.resourceCursor.status} / ${s.resourceCursor.watermarkFrom} — ${s.resourceCursor.watermarkTo}` : "尚无窗口"}</p>)}
      <div className="overflow-x-auto"><table aria-label="Amazon 财务交易" className="w-full min-w-[900px] text-left text-xs"><thead className="bg-surface-muted"><tr>{["交易 / 实际站点", "入账（UTC）", "类型 / 原始状态", "原币金额", "折算金额", "关联订单 / 分类", "站点时区", "原始入库批次", "操作"].map(v => <th className="py-2 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={`${r.sourceId}:${r.transactionId}`} className="border-t border-border"><td className="py-3">{r.transactionId}<span className="block text-muted">{r.marketplaceId}</span></td><td>{new Date(r.postedAt).toISOString()}</td><td>{r.transactionType ?? "未返回"}<span className="block text-muted">{r.rawStatus ?? "未返回"}</span></td><td>{r.originalAmount} {r.currency}</td><td>{r.conversionStatus === "CONVERTED" ? `${r.convertedAmount} ${r.convertedCurrency}` : "未配置有效汇率"}</td><td>{r.orderId ?? "无关联订单"}<span className="block text-muted">{r.classification === "NON_ORDER" ? "非订单交易" : "订单关联"}</span></td><td>{r.marketplaceTimeZone}</td><td className="break-all">{r.sourceRunId}</td><td><Button size="sm" variant="secondary" onClick={() => setSelected(r)}>交易详情</Button></td></tr>)}</tbody></table></div>
      {!result.rows.length && <p className="py-6 text-center text-sm text-muted">当前范围没有已归属的财务交易。请先配置财务策略并提交执行审批。</p>}
      <div className="flex justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>财务上一页</Button><Button size="sm" variant="secondary" disabled={loading || page >= result.pagination.pageCount} onClick={() => setPage(p => p + 1)}>财务下一页</Button></div>
    </>}
    <WorkbenchDialog open={!!selected} drawer title="财务交易详情" onClose={() => setSelected(null)}>{selected && <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 rounded border border-border p-3 text-xs">{[["交易 ID", selected.transactionId], ["实际站点", selected.marketplaceId], ["入账时间（UTC）", new Date(selected.postedAt).toISOString()], ["交易类型", selected.transactionType], ["原始状态", selected.rawStatus], ["原币金额", `${selected.originalAmount} ${selected.currency}`], ["折算金额", selected.conversionStatus === "CONVERTED" ? `${selected.convertedAmount} ${selected.convertedCurrency}` : "未配置有效汇率"], ["关联订单", selected.orderId], ["交易分类", selected.classification === "NON_ORDER" ? "非订单交易" : "订单关联"], ["站点时区", selected.marketplaceTimeZone], ["采集时间", selected.capturedAt], ["原始入库批次", selected.sourceRunId]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 break-all">{value ?? "未返回"}</dd></div>)}</dl>
      <p className="text-xs text-muted">已采集交易不代表最终结算；原币与折算金额分别保留，不跨币种相加。</p>
      <div className="flex flex-wrap gap-3">{onTask && <Button size="sm" variant="secondary" onClick={() => { const id = selected.sourceRunId; setSelected(null); onTask(id); }}>查看来源任务</Button>}{selected.orderId && <a className="self-center text-xs text-brand hover:underline" href={`/operations?${new URLSearchParams({ view: "orders", amazonOrderId: selected.orderId, sellerAccountId: selected.sellerAccountId, marketplaceId: selected.marketplaceId })}`}>查看关联订单</a>}</div>
      {selected.fxEvidence && <section className="space-y-2"><h3 className="text-sm font-medium">汇率依据</h3><BusinessRecordFields fields={selected.fxEvidence} /></section>}
    </div>}</WorkbenchDialog>
  </div>;
}
export function FinancePolicyFields() {
  return <fieldset className="space-y-2 rounded border border-border p-3"><legend className="px-1 text-xs">卖家级财务策略</legend><p className="text-xs text-muted">站点选择仅为管理锚点。策略须列明全部已验证参与站点及其时区，各站点先绑定同一 ERP 店铺。批准后请求不按锚点过滤；缺失归属加密隔离。窗口、应用预算和汇率来源／版本／有效期须显式提供；fx 为 null 时仅保存原币。</p><label className="grid gap-1 text-xs">财务策略 JSON<textarea className={`${input} min-h-48 font-mono`} name="financePolicy" required spellCheck={false} aria-label="财务策略 JSON" /></label></fieldset>;
}
