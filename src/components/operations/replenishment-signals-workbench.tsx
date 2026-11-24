"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Row = {
  marketplaceId: string; sellerSku: string; asin: string;
  fulfillable: number; inbound: number; reserved: number;
  units30: number | null; units90: number | null; daysWithSales30: number;
  dailyDemand30: string | null; daysOfCover: string | null; weeksOfCover: string | null;
  signal: "STOCKOUT_RISK" | "SLOW_MOVING" | "NO_SALE_90D" | "NORMAL";
};
type Summary = { skuCount: number; stockoutRisk: number; slowMoving: number; noSale90d: number; normal: number };
type Result = { rows: Row[]; summary: Summary; basis: string; windowEnd: string; asOf: string; truncated: boolean; source: string };

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const signalLabel: Record<Row["signal"], string> = {
  STOCKOUT_RISK: "断货风险", SLOW_MOVING: "滞销", NO_SALE_90D: "90天无销量", NORMAL: "正常",
};
const columns: DataTableColumn<Row>[] = [
  { key: "sku", header: "Seller SKU", width: 150, render: r => <>{r.sellerSku}<span className="block text-muted">{r.asin || "—"}</span></> },
  { key: "site", header: "站点", width: 90, render: r => r.marketplaceId },
  { key: "fulfillable", header: "可售", width: 70, numeric: true, render: r => r.fulfillable },
  { key: "inbound", header: "在途", width: 70, numeric: true, render: r => r.inbound },
  { key: "units30", header: "30天销量", width: 85, numeric: true, render: r => r.units30 === null ? "—" : r.units30 },
  { key: "daily", header: "日均", width: 70, render: r => r.dailyDemand30 ?? "—" },
  { key: "cover", header: "覆盖天数", width: 85, render: r => r.daysOfCover ?? "—" },
  { key: "weeks", header: "覆盖周数", width: 85, render: r => r.weeksOfCover ?? "—" },
  { key: "signal", header: "信号", width: 100, render: r => <span className={r.signal === "STOCKOUT_RISK" ? "text-danger-ink" : r.signal === "NORMAL" ? "text-success-ink" : "text-warning-ink"}>{signalLabel[r.signal]}</span> },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function ReplenishmentSignalsWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);
  const [sku, setSku] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (sku) params.set("sku", sku);
      const response = await fetch(`/api/operations/replenishment-signals?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "补货信号读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "补货信号读取失败。"); }
    finally { setLoading(false); }
  }, [sku]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  const s = data?.summary;
  return <div data-testid="replenishment-signals-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 补货建议 / 滞销报表。用最新 FBA 库存 + 近30天商品日销量算覆盖天数与周数；<strong>信号仅为提示非决策结论，不伪造 Amazon 补货建议原生字段。</strong></p>
        {s && <div className="flex flex-wrap gap-3 text-xs">
          <span>SKU <strong>{s.skuCount}</strong></span>
          <span className="text-danger-ink">断货风险 <strong>{s.stockoutRisk}</strong></span>
          <span className="text-warning-ink">滞销 <strong>{s.slowMoving}</strong></span>
          <span className="text-warning-ink">90天无销量 <strong>{s.noSale90d}</strong></span>
          <span className="text-success-ink">正常 <strong>{s.normal}</strong></span>
        </div>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="replenishment-signals-window">截至 {data.windowEnd}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">SKU<input className={cls} value={sku} onChange={e => setSku(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={<StandardDataTable ariaLabel="补货信号与覆盖周数" rows={data?.rows ?? []} getRowKey={r => `${r.marketplaceId}:${r.sellerSku}`} columns={columns} empty={loading ? "读取中…" : "暂无 FBA 库存快照，无法生成补货信号。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
