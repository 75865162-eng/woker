"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type HealthRow = {
  sellerSku: string; asin: string; marketplaceId: string;
  fulfillable: number; reserved: number; inbound: number; unfulfillable: number; researching: number;
  total: number; inboundRatio: string | null; riskFlag: "OUT_OF_STOCK_RISK" | "IDLE_SIGNAL" | "NORMAL";
};
type Summary = {
  skuCount: number; fulfillable: number; reserved: number; inbound: number; unfulfillable: number;
  researching: number; outOfStockRiskCount: number; idleSignalCount: number;
};
type Result = { rows: HealthRow[]; summary: Summary; basis: string; asOf: string; truncated: boolean; source: string };

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const riskLabel: Record<HealthRow["riskFlag"], string> = {
  OUT_OF_STOCK_RISK: "缺货风险", IDLE_SIGNAL: "滞销信号", NORMAL: "正常",
};
const columns: DataTableColumn<HealthRow>[] = [
  { key: "sku", header: "Seller SKU", width: 150, render: r => <>{r.sellerSku}<span className="block text-muted">{r.asin || "—"}</span></> },
  { key: "site", header: "站点", width: 90, render: r => r.marketplaceId },
  { key: "fulfillable", header: "可售", width: 80, numeric: true, render: r => r.fulfillable },
  { key: "reserved", header: "预留", width: 80, numeric: true, render: r => r.reserved },
  { key: "inbound", header: "在途", width: 80, numeric: true, render: r => r.inbound },
  { key: "unfulfillable", header: "不可用", width: 80, numeric: true, render: r => r.unfulfillable },
  { key: "researching", header: "调研中", width: 80, numeric: true, render: r => r.researching },
  { key: "total", header: "总量", width: 80, numeric: true, render: r => r.total },
  { key: "ratio", header: "在途占比", width: 90, render: r => r.inboundRatio === null ? "—" : r.inboundRatio },
  { key: "risk", header: "健康信号", width: 100, render: r => <span className={r.riskFlag === "OUT_OF_STOCK_RISK" ? "text-danger-ink" : r.riskFlag === "IDLE_SIGNAL" ? "text-warning-ink" : "text-success-ink"}>{riskLabel[r.riskFlag]}</span> },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function InventoryHealthWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);
  const [sku, setSku] = useState("");
  const [asin, setAsin] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (sku) params.set("sku", sku);
      if (asin) params.set("asin", asin);
      const response = await fetch(`/api/operations/inventory-health?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "库存健康透视读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "库存健康透视读取失败。"); }
    finally { setLoading(false); }
  }, [sku, asin]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  const s = data?.summary;
  return <div data-testid="inventory-health-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor FBA 库存 detail + planning。按站点+SKU 取最新快照做健康分层，状态分列、不推断、不折算。<strong>缺货风险 / 滞销信号仅为提示，非决策结论。</strong></p>
        {s && <div className="flex flex-wrap gap-3 text-xs">
          <span>SKU <strong>{s.skuCount}</strong></span>
          <span>可售 <strong>{s.fulfillable}</strong></span>
          <span>预留 <strong>{s.reserved}</strong></span>
          <span>在途 <strong>{s.inbound}</strong></span>
          <span>不可用 <strong>{s.unfulfillable}</strong></span>
          <span>调研中 <strong>{s.researching}</strong></span>
          <span className="text-danger-ink">缺货风险 <strong>{s.outOfStockRiskCount}</strong></span>
          <span className="text-warning-ink">滞销信号 <strong>{s.idleSignalCount}</strong></span>
        </div>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="inventory-health-asof">快照 {data.asOf}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">SKU<input className={cls} value={sku} onChange={e => setSku(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">ASIN<input className={cls} value={asin} onChange={e => setAsin(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={<StandardDataTable ariaLabel="FBA 库存健康透视" rows={data?.rows ?? []} getRowKey={r => `${r.marketplaceId}:${r.sellerSku}`} columns={columns} empty={loading ? "读取中…" : "暂无 FBA 库存快照，无法生成健康透视。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
