"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Row = {
  marketplaceId: string; sellerSku: string; asin: string;
  returnUnits: number; returnOrders: number; soldUnits: number | null; returnRate: string | null;
  sellable: number; defective: number; unsellable: number; other: number;
};
type Summary = {
  skuCount: number; returnUnits: number; returnOrders: number; soldUnits: number; returnRate: string | null;
  sellable: number; defective: number; unsellable: number; other: number;
};
type Result = {
  rows: Row[]; summary: Summary; basis: string; reportId: string | null;
  from: string; to: string; hasSalesUniverse: boolean; asOf: string; truncated: boolean; source: string;
};

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const columns: DataTableColumn<Row>[] = [
  { key: "sku", header: "Seller SKU", width: 150, render: r => <>{r.sellerSku}<span className="block text-muted">{r.asin || "—"}</span></> },
  { key: "site", header: "站点", width: 90, render: r => r.marketplaceId },
  { key: "returnUnits", header: "退货件数", width: 90, numeric: true, render: r => r.returnUnits },
  { key: "returnOrders", header: "退货订单", width: 90, numeric: true, render: r => r.returnOrders },
  { key: "soldUnits", header: "同期销量", width: 90, numeric: true, render: r => r.soldUnits === null ? "—" : r.soldUnits },
  { key: "returnRate", header: "退货率", width: 90, render: r => r.returnRate === null ? "—" : r.returnRate },
  { key: "sellable", header: "可销售", width: 80, numeric: true, render: r => r.sellable },
  { key: "defective", header: "缺陷/损坏", width: 90, numeric: true, render: r => r.defective },
  { key: "unsellable", header: "不可销售", width: 90, numeric: true, render: r => r.unsellable },
  { key: "other", header: "其他", width: 70, numeric: true, render: r => r.other },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86400000));

export function ReturnAnalyticsWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);
  const [sku, setSku] = useState("");
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => isoDay(new Date()));

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (sku) params.set("sku", sku);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/operations/return-analytics?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "退货归因读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "退货归因读取失败。"); }
    finally { setLoading(false); }
  }, [sku, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  const s = data?.summary;
  return <div data-testid="return-analytics-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 退货率 + 质量归因。退货取单份已发布报告，同期销量取相同站点+SKU 已发布订单；<strong>分母为 0 或无销量时退货率留空，不补零、不造数。</strong></p>
        {s && <div className="flex flex-wrap gap-3 text-xs">
          <span>SKU <strong>{s.skuCount}</strong></span>
          <span>退货件数 <strong>{s.returnUnits}</strong></span>
          <span>退货订单 <strong>{s.returnOrders}</strong></span>
          <span>同期销量 <strong>{s.soldUnits}</strong></span>
          <span>总退货率 <strong>{s.returnRate ?? "—"}</strong></span>
          <span>可销售 <strong>{s.sellable}</strong></span>
          <span>缺陷 <strong>{s.defective}</strong></span>
          <span>不可销售 <strong>{s.unsellable}</strong></span>
        </div>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="return-analytics-window">窗口 {data.from} ~ {data.to}{!data.hasSalesUniverse && "（无同期销量数据）"}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">SKU<input className={cls} value={sku} onChange={e => setSku(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">从<input type="date" className={cls} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">至<input type="date" className={cls} value={to} onChange={e => setTo(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={<StandardDataTable ariaLabel="退货率与质量归因" rows={data?.rows ?? []} getRowKey={r => `${r.marketplaceId}:${r.sellerSku}`} columns={columns} empty={loading ? "读取中…" : "暂无已发布的退货报告，无法生成归因报表。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
