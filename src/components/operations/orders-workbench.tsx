"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type OrderResult = {
  rows: Array<{ amazonOrderId: string; sourceId: string; sourceRunId: string; marketplaceId: string; createdTime: string; sourceUpdatedAt: string; rawStatus: string | null; normalizedStatus: string | null; marketplaceTimeZone: string; detailsCurrent?: boolean; grandTotalOriginal?: string | null; currencyCode?: string | null }>;
  sources: Array<{ id: string; enabled: boolean; marketplaceId: string; detailsEnabled?: boolean; detailsComplete?: boolean; seller: { displayName: string }; resourceCursor: { watermarkFrom: string; watermarkTo: string; lastSuccessAt: string | null; status: string; listComplete?: boolean } | null }>;
  pagination: { total: number; pageCount: number };
};
const utc = (value: string) => new Date(value).toISOString();
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";

export function OrdersWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders, onTask }: { sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers; onTask: (id: string) => void }) {
  const [orderId, setOrderId] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [result, setResult] = useState<OrderResult | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setResult(null); setError("");
    const read = async () => {
      try {
        const params = new URLSearchParams({ section: "orders", sellerAccountId, marketplaceId, amazonOrderId: orderId, from, to, page: String(page) });
        const response = await fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store" });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "订单读取失败。");
        if (current) setResult(value);
      } catch (e) { if (current) setError(e instanceof Error ? e.message : "订单读取失败。"); }
      finally { if (current) setLoading(false); }
    };
    void read();
    return () => { current = false; };
  }, [sellerAccountId, marketplaceId, orderId, from, to, page, refresh, getHeaders]);
  return <div className="space-y-3" data-testid="amazon-orders-workbench">
    <p className="text-xs leading-relaxed text-muted">订单 · Orders 2026-01-01。展示已提交记录；窗口与详情完整性分别标记。详情需单独配置并审批，买家、地址及原始报文不在此展示。</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">订单 ID<input className={input} value={orderId} maxLength={200} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">更新时间从（UTC）<input type="date" className={input} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">更新时间至（UTC，含当日）<input type="date" className={input} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新订单</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted">读取已落库订单…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <div className="space-y-2 text-xs">{result.sources.map(source => <div key={source.id} className="rounded border border-border p-2">
        <span>{source.seller.displayName} / {source.marketplaceId} </span><Badge tone={source.resourceCursor?.status === "SUCCEEDED" ? "green" : "amber"}>{!source.enabled ? "绑定已停用" : source.resourceCursor?.status === "SUCCEEDED" ? "最近窗口完整" : source.resourceCursor ? "窗口未完成" : "尚未同步"}</Badge>
        {source.resourceCursor && <p className="mt-1 break-all text-muted">更新窗口 {utc(source.resourceCursor.watermarkFrom)} — {utc(source.resourceCursor.watermarkTo)} · 最近成功 {source.resourceCursor.lastSuccessAt ? utc(source.resourceCursor.lastSuccessAt) : "—"}</p>}
        <p className="mt-1 text-muted">{source.detailsEnabled ? source.detailsComplete ? "详情补齐完成" : source.resourceCursor?.listComplete ? "列表已完成，详情待补齐" : "详情按单补齐中" : "仅列表，未启用详情"}</p>
      </div>)}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr>{["订单 / 站点", "原始履约状态 / 内部状态", "创建时间（UTC）", "源更新时间（UTC）", "详情 / 订单收入总额", "站点时区 / 来源"].map(label => <th key={label} className="py-2 font-medium">{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={`${row.sourceId}:${row.amazonOrderId}`} className="border-t border-border">
        <td className="py-3">{row.amazonOrderId}<span className="block text-muted">{row.marketplaceId}</span></td><td>{row.rawStatus ?? "未返回"}<span className="block text-muted">{row.normalizedStatus ?? "未映射"}</span></td><td>{utc(row.createdTime)}</td><td>{utc(row.sourceUpdatedAt)}</td><td>{row.detailsCurrent ? "当前版本已补齐" : "详情待补齐 / 未启用"}<span className="block text-muted">{row.detailsCurrent && row.grandTotalOriginal != null ? `${row.grandTotalOriginal} ${row.currencyCode ?? ""}` : "—"}</span></td><td>{row.marketplaceTimeZone}<Button size="sm" variant="secondary" onClick={() => onTask(row.sourceRunId)}>查看来源任务</Button></td>
      </tr>)}</tbody></table></div>
      {!result.rows.length && <p className="py-6 text-center text-sm text-muted">当前范围没有已落库订单。请先在“店铺与授权”配置订单策略，再提交有界同步审批。</p>}
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted"><span>{result.pagination.total} 条 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>订单上一页</Button><Button size="sm" variant="secondary" disabled={page >= result.pagination.pageCount || loading} onClick={() => setPage(v => v + 1)}>订单下一页</Button></div>
    </>}
  </div>;
}

/** Nonsecret policy. No fabricated seller, marketplace, region, timezone or role defaults. */
export function OrderPolicyFields() {
  return <fieldset className="space-y-3 rounded border border-border p-3"><legend className="px-1 text-xs">订单有界增量策略</legend><div className="grid gap-3 sm:grid-cols-2">
    {[["initialFrom", "首次起点（UTC ISO，须明确选择）"], ["marketplaceTimeZone", "站点 IANA 时区"], ["applicationId", "非敏感应用标识（同应用必须一致，禁止填写密钥）"]].map(([name, label]) => <label key={name} className="grid gap-1 text-xs">{label}<input className={input} name={name} required maxLength={2000} /></label>)}
    {[["windowMinutes", "窗口分钟", 60, 1, 1440], ["overlapSeconds", "重叠秒", 120, 1, 3600], ["safetyLagSeconds", "安全延迟秒", 120, 120, 86400], ["requestsPerSecond", "searchOrders 请求/秒", 0.0056, 0.000001, 0.0056], ["burst", "突发预算", 20, 1, 20]].map(([name, label, value, min, max]) => <label key={name} className="grid gap-1 text-xs">{label}<input className={input} name={String(name)} type="number" step={name === "requestsPerSecond" ? "any" : 1} defaultValue={value} min={min} max={max} required /></label>)}
  </div><label className="grid gap-1 text-xs">状态映射 JSON（未映射保留空，不猜测业务口径）<textarea className={`${input} min-h-20 py-2 font-mono`} name="statusMapping" required defaultValue="{}" /></label><label className="grid gap-1 text-xs">可选详情策略 JSON（留空仅列表）<textarea className={`${input} min-h-24 py-2 font-mono`} name="detailsPolicy" maxLength={4000} /></label><p className="text-xs text-muted">详情字段：includedData、purpose（用途代码）、requestsPerSecond（≤0.5）、burst（≤30）、maxOrders（≤5000）。数据集仅支持 FULFILLMENT / PROCEEDS / BUYER / RECIPIENT；PII 需要相应用途的 restricted role，按新版官方契约不申请 Orders RDT。所有原始响应均可能含 PII，整体加密。访问权限统一在账号设置管理，无需在此登记 API 角色；Amazon 按实际授权返回字段。</p></fieldset>;
}
