"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type FinanceResult = {
  rows: Array<{ transactionId: string; marketplaceId: string; postedAt: string; transactionType: string | null; rawStatus: string | null; orderId: string | null; classification: string; originalAmount: string; currency: string; convertedAmount: string | null; convertedCurrency: string | null; conversionStatus: string; marketplaceTimeZone: string }>;
  pagination: { total: number; pageCount: number };
  quarantinedCount: number; unconvertedCount: number;
  sources: Array<{ id: string; seller: { displayName: string }; resourceCursor: { watermarkFrom: string; watermarkTo: string; status: string } | null }>;
};
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";
export function FinanceWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders }: { sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers }) {
  const [currency, setCurrency] = useState(""), [orderId, setOrderId] = useState(""), [classification, setClassification] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [result, setResult] = useState<FinanceResult | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setResult(null); setError("");
    void (async () => {
      try {
        const params = new URLSearchParams({ section: "finance", sellerAccountId, marketplaceId, currency, orderId, classification, from, to, page: String(page) });
        const response = await fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store" });
        const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "财务读取失败。");
        if (active) setResult(value);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "财务读取失败。"); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [sellerAccountId, marketplaceId, currency, orderId, classification, from, to, page, refresh, getHeaders]);
  return <div className="space-y-3" data-testid="amazon-finance-workbench">
    <p className="text-xs leading-relaxed text-muted">财务交易 · Finances 2024-06-19。卖家级采集、按实际站点查询；仅管理员可见。已提交窗口不代表最终结算，延迟入账和递延交易仍需复核。金额保留原币精度，不跨币种合计。</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">币种<input className={input} value={currency} maxLength={3} onChange={e => { setCurrency(e.target.value.toUpperCase()); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">关联订单<input className={input} value={orderId} maxLength={200} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">交易分类<select className={input} value={classification} onChange={e => { setClassification(e.target.value); setPage(1); }}><option value="">全部</option><option value="ORDER_RELATED">订单关联</option><option value="NON_ORDER">非订单交易</option></select></label>
      <label className="grid gap-1 text-xs">入账从（UTC）<input className={input} type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">入账至（含当日）<input className={input} type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新财务</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted">读取已落库交易…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <p className="text-xs text-muted">本范围未折算 {result.unconvertedCount} 条；所选采集源／卖家下待归属隔离 {result.quarantinedCount} 条（不按站点、币种过滤，不计入下表）。</p>
      {result.sources.map(s => <p key={s.id} className="break-all text-xs text-muted">{s.seller.displayName} · {s.resourceCursor ? `${s.resourceCursor.status} / ${s.resourceCursor.watermarkFrom} — ${s.resourceCursor.watermarkTo}` : "尚无窗口"}</p>)}
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr>{["交易 / 实际站点", "入账（UTC）", "类型 / 原始状态", "原币金额", "折算金额", "关联订单 / 分类", "站点时区"].map(v => <th className="py-2 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={r.transactionId} className="border-t border-border"><td className="py-3">{r.transactionId}<span className="block text-muted">{r.marketplaceId}</span></td><td>{new Date(r.postedAt).toISOString()}</td><td>{r.transactionType ?? "未返回"}<span className="block text-muted">{r.rawStatus ?? "未返回"}</span></td><td>{r.originalAmount} {r.currency}</td><td>{r.conversionStatus === "CONVERTED" ? `${r.convertedAmount} ${r.convertedCurrency}` : "未配置有效汇率"}</td><td>{r.orderId ?? "无关联订单"}<span className="block text-muted">{r.classification === "NON_ORDER" ? "非订单交易" : "订单关联"}</span></td><td>{r.marketplaceTimeZone}</td></tr>)}</tbody></table></div>
      {!result.rows.length && <p className="py-6 text-center text-sm text-muted">当前范围没有已归属的财务交易。请先配置财务策略并提交执行审批。</p>}
      <div className="flex justify-end gap-3 text-xs"><span>{result.pagination.total} 条 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>财务上一页</Button><Button size="sm" variant="secondary" disabled={loading || page >= result.pagination.pageCount} onClick={() => setPage(p => p + 1)}>财务下一页</Button></div>
    </>}
  </div>;
}
export function FinancePolicyFields() {
  return <fieldset className="space-y-2 rounded border border-border p-3"><legend className="px-1 text-xs">卖家级财务策略</legend><p className="text-xs text-muted">站点选择仅为管理锚点。策略须列明全部已验证参与站点及其时区，各站点先绑定同一 ERP 店铺。批准后请求不按锚点过滤；缺失归属加密隔离。窗口、应用预算和汇率来源／版本／有效期须显式提供；fx 为 null 时仅保存原币。</p><label className="grid gap-1 text-xs">财务策略 JSON<textarea className={`${input} min-h-48 font-mono`} name="financePolicy" required spellCheck={false} aria-label="财务策略 JSON" /></label></fieldset>;
}
