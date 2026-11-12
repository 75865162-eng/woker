"use client";
import { OrderFulfillmentRecoveryPanel } from "./order-fulfillment-recovery-panel";
import { useEffect, useState } from "react";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type OrderResult = {
  rows: Array<{ amazonOrderId: string; sellerAccountId: string; sourceId: string; sourceRunId: string; marketplaceId: string; createdTime: string; sourceUpdatedAt: string; rawStatus: string | null; normalizedStatus: string | null; marketplaceTimeZone: string; detailsCurrent?: boolean; fulfilledBy?: string | null; fulfillmentServiceLevel?: string | null; grandTotalOriginal?: string | null; currencyCode?: string | null }>;
  sources: Array<{ recoveryTask?: { recoveryOutcome?: { state: string; pagesAdvanced: number; detailsAdvanced: number; pendingDetails: number } | null; progress?: { state: string; message: string; needsAttention: boolean; lastProgressAt: string; progressBasis: string }; id: string; status: string; stage: string; pagesCompleted: number; detailsCompletedCount: number; attempts: number; maxAttempts: number; apiRequests: number; throttles: number; failureReason: string | null; lastHttpErrorStatus: number | null; operatorAction: string | null; canRequestRetry: boolean } | null; id: string; enabled: boolean; marketplaceId: string; detailsEnabled?: boolean; detailsComplete?: boolean; proceedsRequested?: boolean; historicalBackfillEnabled?: boolean; historicalBackfill?: { selected: number; deferred: boolean } | null; historicalBackfillWindow?: { from: string; to: string } | null; seller: { displayName: string }; resourceCursor: { watermarkFrom: string; watermarkTo: string; lastSuccessAt: string | null; status: string; listComplete?: boolean } | null }>;
  pagination: { total: number; pageCount: number };
};
const utc = (value: string) => new Date(value).toISOString();
const input = "min-h-9 rounded border border-border bg-background px-2 text-sm";

// Detail layout adapted from Wimoor order/fbm/components/order_detail.vue (public/licenses/wimoor-MIT.txt).
export function OrdersWorkbench({ sellerAccountId = "", marketplaceId = "", getHeaders, onTask, canConfigure = false, busy = false, requestApproval, openApprovals }: { canConfigure?: boolean; busy?: boolean; requestApproval?: (command: Record<string, unknown>) => Promise<boolean>; openApprovals?: () => void; sellerAccountId?: string; marketplaceId?: string; getHeaders: () => Headers; onTask: (id: string) => void }) {
  const [selectedOrder, setSelectedOrder] = useState<OrderResult["rows"][number] | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [rawStatus, setRawStatus] = useState("");
  const [detailsStatus, setDetailsStatus] = useState("");
  const [fulfilledBy, setFulfilledBy] = useState(""), [fulfillmentServiceLevel, setFulfillmentServiceLevel] = useState("");
  const [orderId, setOrderId] = useState(""), [dateField, setDateField] = useState<"createdTime" | "sourceUpdatedAt">("createdTime"), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [result, setResult] = useState<OrderResult | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const readLocation = () => { setOrderId(new URLSearchParams(window.location.search).get("amazonOrderId") ?? ""); setPage(1); setScopeReady(true); };
    readLocation(); window.addEventListener("popstate", readLocation); return () => window.removeEventListener("popstate", readLocation);
  }, []);
  useEffect(() => {
    if (!scopeReady) return;
    let current = true;
    setLoading(true); setResult(null); setSelectedOrder(null); setError("");
    const read = async () => {
      try {
        const params = new URLSearchParams({ section: "orders", sellerAccountId, marketplaceId, amazonOrderId: orderId, rawStatus, fulfilledBy, fulfillmentServiceLevel, detailsStatus, dateField, from, to, page: String(page) });
        const response = await fetch(`/api/operations/sync-center?${params}`, { headers: getHeaders(), cache: "no-store" });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "订单读取失败。");
        if (current) setResult(value);
      } catch (e) { if (current) setError(e instanceof Error ? e.message : "订单读取失败。"); }
      finally { if (current) setLoading(false); }
    };
    void read();
    return () => { current = false; };
  }, [scopeReady, sellerAccountId, marketplaceId, rawStatus, orderId, fulfilledBy, fulfillmentServiceLevel, detailsStatus, dateField, from, to, page, refresh, getHeaders]);
  return <div className="space-y-3" data-testid="amazon-orders-workbench">
    <p className="text-xs leading-relaxed text-muted">订单 · Orders 2026-01-01。展示已提交记录；窗口与详情完整性分别标记。详情需单独配置并审批，买家、地址及原始报文不在此展示。</p>
    <div className="flex flex-wrap items-end gap-2 rounded border border-border bg-surface-muted p-3">
      <label className="grid gap-1 text-xs">订单 ID<input className={input} value={orderId} maxLength={200} onChange={e => { setOrderId(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">原始履约状态<input className={input} value={rawStatus} maxLength={200} onChange={e => { setRawStatus(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">履约方<input className={input} value={fulfilledBy} maxLength={500} onChange={e => { setFulfilledBy(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">配送服务等级<input className={input} value={fulfillmentServiceLevel} maxLength={500} onChange={e => { setFulfillmentServiceLevel(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">明细状态<select aria-label="明细状态" className={input} value={detailsStatus} onChange={e => { setDetailsStatus(e.target.value); setPage(1); }}><option value="">全部订单</option><option value="MISSING_OR_STALE">待补齐 / 未启用</option><option value="CURRENT">当前版本已补齐</option></select></label>
      <label className="grid gap-1 text-xs">日期口径<select className={input} value={dateField} onChange={e => { setDateField(e.target.value as "createdTime" | "sourceUpdatedAt"); setPage(1); }}><option value="createdTime">下单 / 创建日期</option><option value="sourceUpdatedAt">订单更新时间</option></select></label>
      <label className="grid gap-1 text-xs">{dateField === "createdTime" ? "下单日期" : "更新时间"}从（UTC）<input type="date" className={input} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label className="grid gap-1 text-xs">{dateField === "createdTime" ? "下单日期" : "更新时间"}至（UTC，含当日）<input type="date" className={input} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => { setOrderId(""); setRawStatus(""); setFulfilledBy(""); setFulfillmentServiceLevel(""); setDetailsStatus(""); setDateField("createdTime"); setFrom(""); setTo(""); setPage(1); }}>重置筛选</Button>
      <Button size="sm" variant="secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新订单</Button>
    </div>
    {loading && <p role="status" className="text-sm text-muted">读取已落库订单…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <div className="space-y-2 text-xs">{result.sources.map(source => <div key={source.id} className="rounded border border-border p-2">
        <span>{source.seller.displayName} / {source.marketplaceId} </span><Badge tone={source.resourceCursor?.status === "SUCCEEDED" ? "green" : "amber"}>{!source.enabled ? "绑定已停用" : source.resourceCursor?.status === "SUCCEEDED" ? "最近窗口完整" : source.resourceCursor ? "窗口未完成" : "尚未同步"}</Badge>
        {source.resourceCursor && <p className="mt-1 break-all text-muted">更新窗口 {utc(source.resourceCursor.watermarkFrom)} — {utc(source.resourceCursor.watermarkTo)} · 最近成功 {source.resourceCursor.lastSuccessAt ? utc(source.resourceCursor.lastSuccessAt) : "—"}</p>}
        <p className="mt-1 text-muted">{source.detailsEnabled ? source.detailsComplete ? "详情补齐完成" : source.resourceCursor?.listComplete ? "列表已完成，详情待补齐" : "详情按单补齐中" : "仅列表，未启用详情"}</p>
        {source.recoveryTask && <div className="mt-2 space-y-1 border-t border-border pt-2" data-testid="order-recovery-task">
          <p>当前游标任务：{source.recoveryTask.status} · {source.recoveryTask.stage}</p>
          <p className="text-muted">已提交 {source.recoveryTask.pagesCompleted} 页 · 已补齐 {source.recoveryTask.detailsCompletedCount} 笔明细 · 请求 {source.recoveryTask.apiRequests} 次 · 限流 {source.recoveryTask.throttles} 次 · 尝试 {source.recoveryTask.attempts}/{source.recoveryTask.maxAttempts}</p>
          {source.recoveryTask.recoveryOutcome && <p className="text-muted" data-testid="order-recovery-outcome">恢复后核对：{({ WINDOW_COMPLETED: "当前窗口已完成", FAILED_AGAIN: "恢复后再次失败，需核对", ADVANCED: "已继续推进", AWAITING_PROGRESS: "已应用恢复，等待新进度", COUNTER_MISMATCH: "进度计数异常，需核对", INCONSISTENT_PENDING_WORK: "窗口完成标记与待处理明细不一致，需核对" } as Record<string, string>)[source.recoveryTask.recoveryOutcome.state] ?? "未知"} · 新提交 {source.recoveryTask.recoveryOutcome.pagesAdvanced} 页 · 新补齐 {source.recoveryTask.recoveryOutcome.detailsAdvanced} 笔 · 当前窗口待处理 {source.recoveryTask.recoveryOutcome.pendingDetails} 笔。此核对不代表全历史完整。</p>}
          {source.recoveryTask.progress && <p className={source.recoveryTask.progress.needsAttention ? "text-amber-700" : "text-muted"} data-testid="order-progress-health">{source.recoveryTask.progress.message} · {source.recoveryTask.progress.progressBasis === "COMMITTED_PAGE_OR_DETAIL" ? "最近提交" : "开始等待或执行"} {utc(source.recoveryTask.progress.lastProgressAt)}</p>}
          {source.recoveryTask.failureReason && <p className="text-amber-700">{source.recoveryTask.failureReason}{source.recoveryTask.lastHttpErrorStatus ? ` 最近失败 HTTP ${source.recoveryTask.lastHttpErrorStatus}。` : ""}</p>}
          {source.recoveryTask.operatorAction && <p className="text-muted">{source.recoveryTask.operatorAction}</p>}
          <Button size="sm" variant="secondary" onClick={() => onTask(source.recoveryTask!.id)}>{source.recoveryTask.canRequestRetry ? "查看失败任务并申请重试" : "查看当前同步任务"}</Button>
          {source.recoveryTask.canRequestRetry && <p className="text-muted">此入口仅打开任务；重试须另行申请、批准并应用，不会自动执行。</p>}
        </div>}
        {canConfigure && requestApproval && openApprovals && source.recoveryTask?.status === "SUCCEEDED" && source.detailsEnabled && <details className="mt-2 border-t border-border pt-2"><summary className="cursor-pointer">补齐本窗口历史履约字段</summary><OrderFulfillmentRecoveryPanel key={`${source.id}:${source.recoveryTask.id}`} sourceId={source.id} taskId={source.recoveryTask.id} sellerName={source.seller.displayName} marketplaceId={source.marketplaceId} busy={busy} requestHeaders={getHeaders} requestApproval={requestApproval} openApprovals={openApprovals} /></details>}
        {source.detailsEnabled && source.proceedsRequested === false && <p className="mt-1 text-amber-700">当前未请求订单收入数据；商品明细完整不代表金额完整。</p>}
        {source.detailsEnabled && <div className="mt-2 border-t border-border pt-2" data-testid="order-historical-backfill">
          <p className="font-medium">历史明细补采</p>
          {source.historicalBackfillEnabled === false ? <p className="text-muted">当前未启用历史明细补采。</p> : source.historicalBackfill ? <>
            <p className={source.historicalBackfill.deferred ? "text-amber-700" : "text-muted"}>上次成功窗口分配 {source.historicalBackfill.selected} 笔历史明细；{source.historicalBackfill.deferred ? "仍有积压，后续窗口使用剩余预算继续补齐。" : "该次检查未发现额外积压，不代表完整历史均已采集。"}</p>
            {source.historicalBackfillWindow && <p className="mt-1 text-muted">补采记录所属窗口 {utc(source.historicalBackfillWindow.from)} — {utc(source.historicalBackfillWindow.to)}</p>}
            <p className="mt-1 text-muted">当前窗口完成不代表全历史完整。</p>
          </> : <p className="text-muted">尚无历史补采检查记录，完整性未知。</p>}
        </div>}
      </div>)}</div>
      {detailsStatus && <p className="text-xs text-muted">当前筛选共 {result.pagination.total} 条已落库订单；这是查询范围内的数量，不代表 Amazon 全历史。待补齐包含未启用详情的订单，补采仍需有效授权及批准策略。</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-surface-muted"><tr>{["订单 / 站点", "原始履约状态 / 内部状态", "创建时间（UTC）", "源更新时间（UTC）", "详情 / 订单收入总额", "站点时区 / 来源"].map(label => <th key={label} className="py-2 font-medium">{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={`${row.sourceId}:${row.amazonOrderId}`} className="border-t border-border">
        <td className="py-3"><button type="button" className="text-brand hover:underline" onClick={() => setSelectedOrder(row)}>{row.amazonOrderId}</button><span className="block text-muted">{row.marketplaceId}</span></td><td>{row.rawStatus ?? "未返回"}<span className="block text-muted">{row.normalizedStatus ?? "未映射"}</span><span className="block text-muted">{row.detailsCurrent ? `履约方 ${row.fulfilledBy ?? "未返回"} · 配送等级 ${row.fulfillmentServiceLevel ?? "未返回"}` : "履约详情待更新"}</span></td><td>{utc(row.createdTime)}</td><td>{utc(row.sourceUpdatedAt)}</td><td>{row.detailsCurrent ? "当前版本已补齐" : "详情待补齐 / 未启用"}<span className="block text-muted">{row.detailsCurrent && row.grandTotalOriginal != null ? `${row.grandTotalOriginal} ${row.currencyCode ?? ""}` : row.detailsCurrent ? "金额未返回" : "—"}</span></td><td>{row.marketplaceTimeZone}<Button size="sm" variant="secondary" onClick={() => onTask(row.sourceRunId)}>查看来源任务</Button></td>
      </tr>)}</tbody></table></div>
      {!result.rows.length && <p className="py-6 text-center text-sm text-muted">当前范围没有已落库订单。请先在“店铺与授权”配置订单策略，再提交有界同步审批。</p>}
      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted"><span>{result.pagination.total} 条 · 第 {page} / {Math.max(1, result.pagination.pageCount)} 页</span><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>订单上一页</Button><Button size="sm" variant="secondary" disabled={page >= result.pagination.pageCount || loading} onClick={() => setPage(v => v + 1)}>订单下一页</Button></div>
    </>}
    <WorkbenchDialog open={!!selectedOrder} title="Amazon 订单详情" onClose={() => setSelectedOrder(null)} drawer>
      {selectedOrder && <div className="space-y-4"><dl className="grid gap-4 text-sm sm:grid-cols-2">
        {[["订单号", selectedOrder.amazonOrderId], ["站点", selectedOrder.marketplaceId], ["原始状态", selectedOrder.rawStatus ?? "未返回"], ["内部状态", selectedOrder.normalizedStatus ?? "未映射"], ["创建时间（UTC）", utc(selectedOrder.createdTime)], ["更新时间（UTC）", utc(selectedOrder.sourceUpdatedAt)], ["履约方", selectedOrder.detailsCurrent ? selectedOrder.fulfilledBy ?? "未返回" : "待补齐"], ["配送服务等级", selectedOrder.detailsCurrent ? selectedOrder.fulfillmentServiceLevel ?? "未返回" : "待补齐"], ["订单收入总额", selectedOrder.detailsCurrent && selectedOrder.grandTotalOriginal != null ? selectedOrder.grandTotalOriginal + " " + (selectedOrder.currencyCode ?? "") : "未返回 / 待补齐"], ["站点时区", selectedOrder.marketplaceTimeZone]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
      </dl><p className="text-xs text-muted">仅展示当前权限返回的已采集字段，买家和地址不在此展示。</p><Button size="sm" variant="secondary" onClick={() => { const id = selectedOrder.sourceRunId; setSelectedOrder(null); onTask(id); }}>查看来源任务</Button><a className="ml-3 text-xs text-brand hover:underline" href={`/operations?${new URLSearchParams({ view: "order-items", amazonOrderId: selectedOrder.amazonOrderId, sellerAccountId: selectedOrder.sellerAccountId, marketplaceId: selectedOrder.marketplaceId })}`}>查看订单商品</a></div>}
    </WorkbenchDialog>
  </div>;
}

/** Nonsecret policy. No fabricated seller, marketplace, region, timezone or role defaults. */
export function OrderPolicyFields() {
  return <fieldset className="space-y-3 rounded border border-border p-3"><legend className="px-1 text-xs">订单有界增量策略</legend><div className="grid gap-3 sm:grid-cols-2">
    {[["initialFrom", "首次起点（UTC ISO，须明确选择）"], ["marketplaceTimeZone", "站点 IANA 时区"], ["applicationId", "非敏感应用标识（同应用必须一致，禁止填写密钥）"]].map(([name, label]) => <label key={name} className="grid gap-1 text-xs">{label}<input className={input} name={name} required maxLength={2000} /></label>)}
    {[["windowMinutes", "窗口分钟", 60, 1, 1440], ["overlapSeconds", "重叠秒", 120, 1, 3600], ["safetyLagSeconds", "安全延迟秒", 120, 120, 86400], ["requestsPerSecond", "searchOrders 请求/秒", 0.0056, 0.000001, 0.0056], ["burst", "突发预算", 20, 1, 20]].map(([name, label, value, min, max]) => <label key={name} className="grid gap-1 text-xs">{label}<input className={input} name={String(name)} type="number" step={name === "requestsPerSecond" ? "any" : 1} defaultValue={value} min={min} max={max} required /></label>)}
  </div><label className="grid gap-1 text-xs">状态映射 JSON（未映射保留空，不猜测业务口径）<textarea className={`${input} min-h-20 py-2 font-mono`} name="statusMapping" required defaultValue="{}" /></label><label className="grid gap-1 text-xs">可选详情策略 JSON（留空仅列表）<textarea className={`${input} min-h-24 py-2 font-mono`} name="detailsPolicy" maxLength={4000} /></label><p className="text-xs text-muted">详情字段：includedData、purpose（用途代码）、requestsPerSecond（≤0.5）、burst（≤30）、maxOrders（≤5000）。数据集仅支持 FULFILLMENT / PROCEEDS / BUYER / RECIPIENT；PII 需要相应用途的 restricted role，按新版官方契约不申请 Orders RDT。所有原始响应均可能含 PII，整体加密。访问权限统一在账号设置管理，无需在此登记 API 角色；Amazon 按实际授权返回字段。</p></fieldset>;
}
