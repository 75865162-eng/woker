"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { ApprovalCenterData, ApprovalView, ApprovalItem } from "@/lib/approvals/center-read";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  EXPIRED: "已过期",
};

function formatAmount(item: ApprovalItem): string {
  if (item.amount === null) return "—";
  const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(item.amount);
  const symbol = item.currency === "CNY" ? "¥" : item.currency === "USD" ? "$" : "";
  return `${symbol}${number}`;
}

export function ApprovalCenter() {
  const [view, setView] = useState<ApprovalView>("toReview");
  const [data, setData] = useState<ApprovalCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: ApprovalView) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/center?view=${next}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as ApprovalCenterData);
    } catch {
      setError("审批数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(view);
  }, [load, view]);

  return (
    <div className="flex flex-col gap-[var(--gap-section)]">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {(["toReview", "myRequests"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`rounded px-3 py-1.5 text-label transition-colors ${view === key ? "bg-info-soft text-brand" : "text-muted hover:text-foreground"}`}
            >
              {key === "toReview" ? "我审批的" : "我发起的"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load(view)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-label text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50">
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          刷新
        </button>
      </section>

      {error ? <div className="rounded-lg border border-danger/20 bg-danger-soft p-4 text-sm text-danger-ink">{error}。<button type="button" onClick={() => void load(view)} className="underline">重试</button></div> : null}

      {!loading && data && Object.keys(data.counts).length > 0 ? (
        <section className="flex flex-wrap gap-2">
          {Object.entries(data.counts).map(([category, count]) => (
            <span key={category} className="rounded-md border border-border bg-surface px-2.5 py-1 text-label text-muted">{category} · <b className="tabular-nums text-foreground">{count}</b></span>
          ))}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-normal">类型</th>
                <th className="px-3 py-2 text-left font-normal">单号</th>
                <th className="px-3 py-2 text-left font-normal">状态</th>
                <th className="px-3 py-2 text-right font-normal">金额</th>
                <th className="px-3 py-2 text-left font-normal">提交时间</th>
                <th className="px-3 py-2 text-left font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-surface-muted" /></td></tr>
                  ))
                : data?.items.length
                  ? data.items.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2 text-foreground">{item.categoryLabel}</td>
                        <td className="px-3 py-2 font-mono text-label text-muted">{item.reference ?? item.id}</td>
                        <td className="whitespace-nowrap px-3 py-2"><span className="rounded border border-border px-1.5 py-0.5 text-label">{STATUS_LABEL[item.status] ?? item.status}</span></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">{formatAmount(item)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-label text-muted">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Link href={item.href} className="inline-flex items-center gap-0.5 text-label text-brand hover:underline">去处理 <ArrowUpRight className="h-3 w-3" /></Link>
                        </td>
                      </tr>
                    ))
                  : <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">{view === "toReview" ? "没有待你审批的单据" : "你没有发起的审批单据"}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-label text-muted">审批动作在对应工作台完成，仍执行禁自批、单据版本与有效期校验；此处仅聚合待办视图。</p>
    </div>
  );
}
