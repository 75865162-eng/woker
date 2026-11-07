"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type ReturnsResult = {
  rows: Array<{ id: string; amazonOrderId: string; asin: string; sellerSku: string; returnAt: string; quantity: number; disposition: string | null; rawStatus: string | null; marketplaceTimeZone: string; reason: { code: string } | null; orderMatched: boolean }>;
  sources: Array<{ id: string; marketplaceId: string; seller: { displayName: string }; latestReportId: string | null }>;
  selectedSourceId: string | null; reportId: string | null; completeness: string;
  pagination: { total: number; pageCount: number };
};
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
export function ReturnsWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders }: { sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers }) {
  const [sourceId, setSourceId] = useState(""), [reportId, setReportId] = useState(""), [orderId, setOrderId] = useState(""), [asin, setAsin] = useState(""), [reason, setReason] = useState(""), [rawStatus, setRawStatus] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [result, setResult] = useState<ReturnsResult | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setResult(null); setError("");
    void (async () => {
      try {
        const params = new URLSearchParams({ section: "returns", sellerAccountId, marketplaceId, sourceId, reportId, orderId, asin, reason, rawStatus, from, to, page: String(page) });
        const response = await fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store" });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "退货读取失败。");
        if (active) setResult(value);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "退货读取失败。"); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [sellerAccountId, marketplaceId, sourceId, reportId, orderId, asin, reason, rawStatus, from, to, page, refresh, getHeaders]);
  return <div className="space-y-3" data-testid="amazon-returns-workbench">
    <p className="text-xs leading-relaxed text-muted">FBA 仓收退货 · Reports 2021-06-30。仅覆盖仓库已收到的退货，按单份已发布报告查询；不同报告可能重叠，不能跨报告累加。同报告完全相同行已折叠，件数以 quantity 为准。此报告不表示退款或售后全量。</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">退货数据源<select className={input} value={sourceId || result?.selectedSourceId || ""} onChange={e => { setSourceId(e.target.value); setReportId(""); setPage(1); }}><option value="">首个可访问数据源</option>{result?.sources.map(s => <option value={s.id} key={s.id}>{s.seller.displayName} / {s.marketplaceId}</option>)}</select></label>
      <label className="grid gap-1 text-xs">报告 ID（空为最新）<input className={input} value={reportId} maxLength={200} onChange={e => { setReportId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">关联订单<input className={input} value={orderId} maxLength={200} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">ASIN<input className={input} value={asin} maxLength={200} onChange={e => { setAsin(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">原始原因<input className={input} value={reason} maxLength={500} onChange={e => { setReason(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">原始状态<input className={input} value={rawStatus} maxLength={200} onChange={e => { setRawStatus(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">仓收从（UTC）<input className={input} type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">仓收至（含当日）<input className={input} type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新退货</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted">读取已发布退货报告…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <p className="break-all text-xs text-muted">{result.reportId ? `当前报告：${result.reportId} · 单份报告已完整提交` : "尚无可访问的已发布报告"}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr>{["订单 / 关联", "ASIN / SKU", "仓收（UTC）", "件数", "原始原因 / 状态", "处置 / 站点时区"].map(v => <th className="py-2 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={r.id} className="border-t border-border"><td className="py-3">{r.amazonOrderId}<span className="block text-muted">{r.orderMatched ? "已匹配订单" : "尚未匹配订单"}</span></td><td>{r.asin}<span className="block text-muted">{r.sellerSku}</span></td><td>{new Date(r.returnAt).toISOString()}</td><td>{r.quantity}</td><td>{r.reason?.code ?? "未返回"}<span className="block text-muted">{r.rawStatus ?? "未返回"}</span></td><td>{r.disposition ?? "未返回"}<span className="block text-muted">{r.marketplaceTimeZone}</span></td></tr>)}</tbody></table></div>
      {!result.rows.length && <p className="py-6 text-center text-sm text-muted">{result.reportId ? "本报告当前筛选无退货明细。" : "当前范围没有已发布退货报告。请先配置退货策略并提交执行审批。"}</p>}
      <div className="flex justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => { setSourceId(result.selectedSourceId ?? ""); setReportId(result.reportId ?? ""); setPage(p => p - 1); }}>退货上一页</Button><Button size="sm" variant="secondary" disabled={loading || page >= result.pagination.pageCount} onClick={() => { setSourceId(result.selectedSourceId ?? ""); setReportId(result.reportId ?? ""); setPage(p => p + 1); }}>退货下一页</Button></div>
    </>}
  </div>;
}
export function ReturnsPolicyFields() {
  return <fieldset className="space-y-2 rounded border border-border p-3"><legend className="px-1 text-xs">FBA 仓收退货策略</legend><p className="text-xs text-muted">仅支持已核验 FBA Returns 类型。窗口、回查、安全延迟、时区、三操作预算、轮询次数／退避及解析批次须显式配置。需已确认的 Pricing 或 Amazon Fulfillment 角色；原件加密留档，普通页面不展示客户评论。未明确时区的报告日期拒绝发布。</p><label className="grid gap-1 text-xs">退货策略 JSON<textarea className={`${input} min-h-48 font-mono`} name="returnsPolicy" required spellCheck={false} aria-label="退货策略 JSON" /></label></fieldset>;
}
