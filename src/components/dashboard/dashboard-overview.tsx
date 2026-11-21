"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { DashboardData, DashboardKpi, DashboardRankRow } from "@/lib/sellfox/dashboard-read";

function formatValue(kpi: DashboardKpi): string {
  if (kpi.value === null) return kpi.currency === "MULTI" ? "多币种" : "—";
  const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(kpi.value);
  if (!kpi.currency || kpi.currency === "MULTI") return number;
  const symbol = kpi.currency === "CNY" ? "¥" : kpi.currency === "USD" ? "$" : "";
  return `${symbol}${number}`;
}

function Sparkline({ points }: { points: DashboardData["sales"]["points"] }) {
  const path = useMemo(() => {
    const values = points.map((p) => p.quantity).filter((v) => Number.isFinite(v));
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const width = 260;
    const height = 56;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / span) * height;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);

  if (!path) {
    return <p className="py-6 text-center text-sm text-muted">暂无销量趋势数据</p>;
  }
  return (
    <svg viewBox="0 0 260 56" className="h-14 w-full text-brand" preserveAspectRatio="none" role="img" aria-label="近30天销量趋势">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiCard({ kpi }: { kpi: DashboardKpi }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-label text-muted">{kpi.label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{formatValue(kpi)}</p>
      {kpi.source ? <p className="mt-1 text-label text-muted">来源：{kpi.source === "aggregate" ? "预聚合" : kpi.source === "live" ? "实时" : "快照"}</p> : null}
    </div>
  );
}

function Ranking({ rows }: { rows: DashboardRankRow[] }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted">暂无销售排行数据</p>;
  return (
    <ol className="divide-y divide-border">
      {rows.map((row, index) => (
        <li key={row.storeId} className="flex items-center justify-between gap-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-5 shrink-0 text-label tabular-nums text-muted">{index + 1}</span>
            <span className="truncate text-sm text-foreground">{row.storeName}</span>
          </span>
          <span className="shrink-0 text-sm tabular-nums text-foreground">{row.revenue === null ? "—" : formatValue({ key: "", label: "", value: row.revenue, currency: null, source: null })}</span>
        </li>
      ))}
    </ol>
  );
}

export function DashboardOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as DashboardData);
    } catch {
      setError("经营数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-[var(--gap-section)]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-section text-foreground">经营总览</h2>
            {data ? <p className="mt-1 text-label text-muted">数据窗口 {data.window.from} ~ {data.window.to}</p> : null}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-label text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50">
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            刷新
          </button>
        </div>

        {error ? <div className="rounded-lg border border-danger/20 bg-danger-soft p-4 text-sm text-danger-ink">{error}。<button type="button" onClick={() => void load()} className="underline">重试</button></div> : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {loading || !data
            ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-lg border border-border bg-surface-muted" />)
            : data.kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
        </div>
      </section>

      <section className="grid gap-[var(--gap-section)] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-section text-foreground">销量趋势</h3>
          <p className="mt-1 text-label text-muted">近 30 天每日销量</p>
          {loading || !data ? <div className="mt-3 h-14 animate-pulse rounded bg-surface-muted" /> : <div className="mt-3"><Sparkline points={data.sales.points} /></div>}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-section text-foreground">销售排行</h3>
            <Link href="/sellfox/sales" className="inline-flex items-center gap-0.5 text-label text-brand hover:underline">详情 <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          <div className="mt-2">{loading || !data ? <div className="h-24 animate-pulse rounded bg-surface-muted" /> : <Ranking rows={data.ranking} />}</div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {loading || !data
          ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-surface-muted" />)
          : <>
              <Link href="/purchase/approvals" className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-brand">
                <p className="text-label text-muted">待处理审批</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{data.pendingCount}</p>
              </Link>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-label text-muted">已接店铺</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{data.coverage.stores}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-label text-muted">最近同步</p>
                <p className="mt-1 text-sm text-foreground">{data.coverage.lastSyncAt ? new Date(data.coverage.lastSyncAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</p>
              </div>
              <Link href="/versions" className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-brand">
                <p className="text-label text-muted">数据版本审计</p>
                <p className="mt-1 text-sm text-brand">查看留痕 <ArrowUpRight className="inline h-3 w-3" /></p>
              </Link>
            </>}
      </section>
    </div>
  );
}
