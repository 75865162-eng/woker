"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type TypeRow = { transactionType: string; currency: string; lineCount: number; distinctOrders: number; amount: string };
type MonthRow = { month: string; currency: string; transactionType: string; lineCount: number; amount: string };
type Result = {
  typeRows: TypeRow[]; monthRows: MonthRow[]; basis: string; asOf: string;
  totalLines: number; quarantinedCount: number; truncated: boolean; source: string;
};

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const typeColumns: DataTableColumn<TypeRow>[] = [
  { key: "type", header: "交易类型", width: 200, render: r => r.transactionType },
  { key: "currency", header: "币种", width: 72, render: r => r.currency },
  { key: "lineCount", header: "结算行数", width: 100, numeric: true, render: r => r.lineCount },
  { key: "orders", header: "去重订单数", width: 110, numeric: true, render: r => r.distinctOrders },
  { key: "amount", header: "金额合计（原币）", width: 140, numeric: true, render: r => <span className={r.amount.startsWith("-") ? "text-danger-ink" : "text-success-ink"}>{r.amount}</span> },
];
const monthColumns: DataTableColumn<MonthRow>[] = [
  { key: "month", header: "业务月", width: 110, render: r => r.month },
  { key: "currency", header: "币种", width: 72, render: r => r.currency },
  { key: "type", header: "交易类型", width: 180, render: r => r.transactionType },
  { key: "lineCount", header: "行数", width: 80, numeric: true, render: r => r.lineCount },
  { key: "amount", header: "金额（原币）", width: 130, numeric: true, render: r => <span className={r.amount.startsWith("-") ? "text-danger-ink" : "text-success-ink"}>{r.amount}</span> },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function SettlementMonthlySummaryWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"MONTH" | "TYPE">("MONTH");
  const [showBasis, setShowBasis] = useState(false);
  const [month, setMonth] = useState("");
  const [currency, setCurrency] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (currency) params.set("currency", currency);
      const response = await fetch(`/api/operations/settlement-monthly-summary?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "结算月度汇总读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "结算月度汇总读取失败。"); }
    finally { setLoading(false); }
  }, [month, currency]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="settlement-monthly-summary-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 结算记录 / 月度汇总。仅统计 Amazon 结算报告已归属（ATTRIBUTED）行，<strong>原币分列不折算</strong>；订单数按去重订单，缺业务日不补零。</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="settlement-summary-asof">已归属 {data.totalLines} 行 · 隔离 {data.quarantinedCount} 行 · 快照 {data.asOf}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <div className="flex gap-1">
          <button type="button" aria-pressed={tab === "MONTH"} className={`rounded border px-3 py-1 text-sm ${tab === "MONTH" ? "border-border bg-surface" : "border-border text-muted"}`} onClick={() => setTab("MONTH")}>月度趋势</button>
          <button type="button" aria-pressed={tab === "TYPE"} className={`rounded border px-3 py-1 text-sm ${tab === "TYPE" ? "border-border bg-surface" : "border-border text-muted"}`} onClick={() => setTab("TYPE")}>交易类型透视</button>
        </div>
        <label className="grid gap-1 text-xs">业务月<input className={cls} placeholder="2026-11" value={month} onChange={e => setMonth(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">币种<input className={cls} placeholder="USD" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={tab === "MONTH"
        ? <StandardDataTable ariaLabel="结算月度趋势" rows={data?.monthRows ?? []} getRowKey={r => `${r.month}:${r.currency}:${r.transactionType}`} columns={monthColumns} empty={loading ? "读取中…" : "暂无已归属结算行，无法生成月度趋势。"} />
        : <StandardDataTable ariaLabel="结算交易类型透视" rows={data?.typeRows ?? []} getRowKey={r => `${r.transactionType}:${r.currency}`} columns={typeColumns} empty={loading ? "读取中…" : "暂无已归属结算行。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
