"use client";
import { useCallback, useEffect, useState } from "react";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

type FeeTypeRow = { transactionType: string; currency: string; count: number; amount: string };
type MonthRow = { month: string; currency: string; orderCount: number; orderAmount: string; nonOrderCount: number; nonOrderAmount: string; netAmount: string };
type Result = {
  feeRows: FeeTypeRow[]; monthRows: MonthRow[]; basis: string; asOf: string;
  totalLines: number; quarantinedCount: number; truncated: boolean; source: string;
};

const cls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const feeColumns: DataTableColumn<FeeTypeRow>[] = [
  { key: "type", header: "交易/费用类型", width: 200, render: r => r.transactionType },
  { key: "currency", header: "币种", width: 72, render: r => r.currency },
  { key: "count", header: "笔数", width: 90, numeric: true, render: r => r.count },
  { key: "amount", header: "金额合计（原币）", width: 140, numeric: true, render: r => <span className={r.amount.startsWith("-") ? "text-danger-ink" : "text-success-ink"}>{r.amount}</span> },
];
const monthColumns: DataTableColumn<MonthRow>[] = [
  { key: "month", header: "业务月（UTC）", width: 120, render: r => r.month },
  { key: "currency", header: "币种", width: 72, render: r => r.currency },
  { key: "orderAmount", header: "订单收入", width: 120, numeric: true, render: r => r.orderAmount },
  { key: "orderCount", header: "收入笔数", width: 90, numeric: true, render: r => r.orderCount },
  { key: "nonOrderAmount", header: "非订单费用", width: 120, numeric: true, render: r => <span className={r.nonOrderAmount.startsWith("-") ? "text-danger-ink" : ""}>{r.nonOrderAmount}</span> },
  { key: "nonOrderCount", header: "费用笔数", width: 90, numeric: true, render: r => r.nonOrderCount },
  { key: "netAmount", header: "净额", width: 120, numeric: true, render: r => <span className={r.netAmount.startsWith("-") ? "text-danger-ink" : "text-success-ink"}>{r.netAmount}</span> },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}") as { workspaceId?: string }; h.set("x-workspace-id", v.workspaceId || "default"); }
  catch { h.set("x-workspace-id", "default"); }
  return h;
}

export function FinanceTransactionAnalyticsWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"MONTH" | "FEE">("MONTH");
  const [showBasis, setShowBasis] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/operations/finance-transaction-analytics?${params}`, { headers: headersForScope(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "财务交易透视读取失败。");
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "财务交易透视读取失败。"); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="finance-transaction-analytics-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">迁移自 Wimoor 交易报告的费用统计与月度经营报告。仅统计 Amazon Finances 已归属（ATTRIBUTED）交易，<strong>原币分列不折算</strong>，负数即扣费保留原符号。已提交窗口不代表最终结算。</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? "收起" : "查看"}完整口径说明</button>
          {data && <span className="text-muted" data-testid="finance-analytics-asof">已归属 {data.totalLines} 行 · 隔离 {data.quarantinedCount} 行 · 快照 {data.asOf}{data.truncated ? "（部分数据）" : ""}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <div className="flex gap-1">
          <button type="button" aria-pressed={tab === "MONTH"} className={`rounded border px-3 py-1 text-sm ${tab === "MONTH" ? "border-border bg-surface" : "border-border text-muted"}`} onClick={() => setTab("MONTH")}>月度经营</button>
          <button type="button" aria-pressed={tab === "FEE"} className={`rounded border px-3 py-1 text-sm ${tab === "FEE" ? "border-border bg-surface" : "border-border text-muted"}`} onClick={() => setTab("FEE")}>费用类型统计</button>
        </div>
        <label className="grid gap-1 text-xs">入账从（UTC）<input className={cls} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">入账至（UTC）<input className={cls} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? "读取中…" : "刷新"}</button>
      </section>}
      table={tab === "MONTH"
        ? <StandardDataTable ariaLabel="财务月度经营透视" rows={data?.monthRows ?? []} getRowKey={r => `${r.month}:${r.currency}`} columns={monthColumns} empty={loading ? "读取中…" : "暂无已归属财务交易，无法生成月度经营透视。"} />
        : <StandardDataTable ariaLabel="财务费用类型统计" rows={data?.feeRows ?? []} getRowKey={r => `${r.transactionType}:${r.currency}`} columns={feeColumns} empty={loading ? "读取中…" : "暂无已归属财务交易。"} />}
    />
    {data?.source && <p className="mt-2 text-xs text-muted">数据来源：{data.source}（与赛狐数据严格隔离）。</p>}
  </div>;
}
