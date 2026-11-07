"use client";
import { useEffect, useState } from "react";
import type { readBrandAsinAnalysis } from "@/lib/amazon-sync/brand-analytics-query";
import { brandReports, brandPeriodLabels, type BrandKind, type BrandPeriod } from "@/lib/amazon-sync/brand-reports";
import { brandColumns, brandFactValue, brandValue } from "@/lib/amazon-sync/brand-fields";
import { Button } from "@/components/ui/button";
import { BrandProductCard } from "./brand-product-card";

type Result = Awaited<ReturnType<typeof readBrandAsinAnalysis>>;
const input = "min-h-9 rounded border border-border bg-background px-2 text-xs";
export function BrandAsinWorkbench({ sourceId, initialAsin, getHeaders, onTask, onReport }: { sourceId: string; initialAsin: string; getHeaders: () => Headers; onTask: (id: string) => void; onReport: (kind: BrandKind, asin: string, period: string, from: string, to: string) => void }) {
  const [draft, setDraft] = useState(initialAsin), [selection, setSelection] = useState({ asin: initialAsin, reportPeriod: "WEEK", from: "", to: "" });
  const [period, setPeriod] = useState("WEEK"), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setError("");
    if (!/^[A-Z0-9]{10}$/.test(selection.asin) || !sourceId) { setLoading(false); return; }
    setLoading(true);
    const p = new URLSearchParams({ section: "brand-asin-analysis", sourceId, ...selection });
    void fetch(`/api/operations/sync-center?${p}`, { headers: getHeaders(), cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "ASIN 分析读取失败。"); if (!controller.signal.aborted) setResult(data); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceId, selection, getHeaders]);
  return <section className="space-y-4" aria-label="ASIN 品牌分析">
    <h3 className="text-sm font-semibold">ASIN 品牌分析</h3><p className="text-xs text-muted">同一店铺、站点和 ASIN 下查看五类报告。多个 SKU 共享一份 ASIN 指标；各报告保留自己的周期，不跨报告累加。商品资料取当前已发布快照，不能代表历史时点的品牌归属。</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); const asin = draft.trim().toUpperCase(); if (!/^[A-Z0-9]{10}$/.test(asin)) { setResult(null); setError("请输入 10 位 ASIN。"); return; } const url = new URL(window.location.href); url.searchParams.set("asin", asin); window.history.replaceState(null, "", url); setSelection({ asin, reportPeriod: period, from, to }); }}>
      <label className="grid gap-1 text-xs">分析 ASIN<input className={input} value={draft} onChange={e => setDraft(e.target.value)} required /></label>
      <label className="grid gap-1 text-xs">分析粒度<select className={input} value={period} onChange={e => setPeriod(e.target.value)}>{Object.entries(brandPeriodLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label className="grid gap-1 text-xs">分析范围起<input className={input} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="grid gap-1 text-xs">分析范围止<input className={input} type="date" value={to} onChange={e => setTo(e.target.value)} /></label><Button size="sm" disabled={loading || !sourceId}>查询 ASIN</Button>
    </form>
    {!selection.asin && <p className="text-sm text-muted">输入 ASIN，或从报表商品资料进入分析。</p>}{loading && <p role="status">读取 ASIN 品牌分析…</p>}{error && <p role="alert">{error}</p>}
    {result && <><p className="text-xs">{result.asin} · {brandPeriodLabels[result.reportPeriod as BrandPeriod]}</p><BrandProductCard product={result.products[result.asin]} onTask={onTask} />{result.productWarnings.map(w => <p key={w} className="text-xs text-muted">{w}</p>)}
      {result.reports.map(report => <section key={report.reportKind} className="space-y-2 rounded border border-border p-3"><h4 className="text-sm font-medium">{brandReports[report.reportKind].label}</h4>{report.unavailable ? <p className="text-xs text-muted">该报告不支持所选粒度。</p> : <>
        <p className="text-xs text-muted">{report.result?.run ? `${report.result.run.coverage?.from} — ${report.result.run.coverage?.to}；${report.result.batchCount} 个已发布批次` : "所选范围没有已发布报告。"} · 共 {report.result?.pagination.total ?? 0} 条，最多预览 50 条</p>
        {!!report.result?.rows.length && <div className="overflow-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr>{[...brandColumns[report.reportKind].map(([, label]) => label), "来源"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{report.result.rows.map(row => <tr key={row.id} className="border-t border-border">{brandColumns[report.reportKind].map(([path]) => <td key={path} className="p-2">{brandValue(brandFactValue(row.facts as Record<string, unknown>, path))}</td>)}<td><Button size="sm" variant="secondary" onClick={() => onTask(row.sourceRunId)}>来源任务</Button></td></tr>)}</tbody></table></div>}
        <Button size="sm" variant="secondary" onClick={() => onReport(report.reportKind, selection.asin, selection.reportPeriod, selection.from, selection.to)}>查看完整报表与历史版本</Button>
      </>}</section>)}
    </>}
  </section>;
}
