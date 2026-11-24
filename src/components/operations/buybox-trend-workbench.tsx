"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type Row = {
  asin: string; periodKey: string; periodStart: string; periodEnd: string;
  avgBuyBoxPercentage: string | null; sessions: number | null; pageViews: number | null; daysWithData: number;
};
type Result = { rows: Row[]; basis: string; bucket: string; asOf: string; truncated: boolean; source: string };

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const columns: DataTableColumn<Row>[] = [
  { key: "asin", header: "ASIN", width: 150, render: r => r.asin },
  { key: "period", header: "周期", width: 110, render: r => r.periodKey },
  { key: "range", header: "区间", width: 180, render: r => `${r.periodStart} ~ ${r.periodEnd}` },
  { key: "buybox", header: "BuyBox 占比", width: 110, numeric: true, render: r => r.avgBuyBoxPercentage === null ? "—" : `${r.avgBuyBoxPercentage}%` },
  { key: "sessions", header: "Sessions", width: 100, numeric: true, render: r => r.sessions === null ? "—" : r.sessions },
  { key: "views", header: "PageViews", width: 100, numeric: true, render: r => r.pageViews === null ? "—" : r.pageViews },
  { key: "days", header: "覆盖天数", width: 90, numeric: true, render: r => r.daysWithData },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function BuyBoxTrendWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);
  const [bucket, setBucket] = useState<"week" | "month">("week");
  const [asin, setAsin] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      params.set("bucket", bucket);
      if (asin) params.set("asin", asin);
      const response = await fetch(`/api/operations/buybox-traffic-trend?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "BuyBox 趋势读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BuyBox 趋势读取失败。"); }
    finally { setLoading(false); }
  }, [bucket, asin]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="buybox-trend-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 商品浏览量报表。按 ASIN 自然周/月上卷 BuyBox 占比均值、Sessions、PageViews 与覆盖天数。<strong>占比为 0-100 百分数原样，缺失留空不补零；与滚动窗口宽表互补。</strong></p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="buybox-trend-asof">快照 {data.asOf}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">周期
          <select className={cls} value={bucket} onChange={e => setBucket(e.target.value as "week" | "month")}>
            <option value="week">自然周</option><option value="month">自然月</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">ASIN<input className={cls} value={asin} onChange={e => setAsin(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={<StandardDataTable ariaLabel="BuyBox 与流量趋势" rows={data?.rows ?? []} getRowKey={r => `${r.asin}:${r.periodKey}`} columns={columns} empty={loading ? "读取中…" : "暂无 BUY_BOX_DAY 观察，无法生成流量趋势。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
