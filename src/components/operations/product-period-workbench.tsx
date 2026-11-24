"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Metrics = { units: number | null; sessions: number | null; pageViews: number | null; cvr: string | null; daysWithData: number };
type Row = { marketplaceId: string; identity: string; d7: Metrics; d15: Metrics; d30: Metrics; d90: Metrics };
type Result = { rows: Row[]; basis: string; granularity: string; windowEnd: string; asOf: string; truncated: boolean; source: string };

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const periodCol = (key: string, label: string): DataTableColumn<Row> => ({
  key, header: label, width: 150, render: r => {
    const m = r[key as "d7"] as Metrics;
    return <span className="text-xs">销 <strong>{m.units ?? "—"}</strong> · 访 <strong>{m.sessions ?? "—"}</strong> · CVR <strong>{m.cvr ?? "—"}</strong></span>;
  },
});
const columns: DataTableColumn<Row>[] = [
  { key: "identity", header: "ASIN / SKU", width: 160, render: r => r.identity },
  { key: "site", header: "站点", width: 90, render: r => r.marketplaceId },
  periodCol("d7", "近 7 天"),
  periodCol("d15", "近 15 天"),
  periodCol("d30", "近 30 天"),
  periodCol("d90", "近 90 天"),
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function ProductPeriodWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);
  const [granularity, setGranularity] = useState<"CHILD" | "SKU">("CHILD");
  const [identity, setIdentity] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      params.set("granularity", granularity);
      if (identity) params.set("identity", identity);
      const response = await fetch(`/api/operations/product-period-analytics?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "商品多周期读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "商品多周期读取失败。"); }
    finally { setLoading(false); }
  }, [granularity, identity]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="product-period-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 商品分析。按 SKU/ASIN 的 7/15/30/90 天滚动销量、Sessions、PageViews 与 CVR（销量/访问）。<strong>缺失指标留空，不补零、不折算金额；BuyBox 占比由 BuyBox 历史页承载。</strong></p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="product-period-window">截至 {data.windowEnd}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">粒度
          <select className={cls} value={granularity} onChange={e => setGranularity(e.target.value as "CHILD" | "SKU")}>
            <option value="CHILD">子 ASIN</option><option value="SKU">Seller SKU</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">{granularity === "SKU" ? "SKU" : "ASIN"}<input className={cls} value={identity} onChange={e => setIdentity(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={<StandardDataTable ariaLabel="商品多周期销量宽表" rows={data?.rows ?? []} getRowKey={r => `${r.marketplaceId}:${r.identity}`} columns={columns} empty={loading ? "读取中…" : "暂无商品日事实，无法生成多周期宽表。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
