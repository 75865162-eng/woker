"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { readActualFieldCoverage } from "@/lib/amazon-sync/actual-field-coverage";
type Report = Awaited<ReturnType<typeof readActualFieldCoverage>>;

/** Read-only metrics use the server's actual business reader and evidence. */
export function ActualFieldCoveragePanel({ sourceId, requestHeaders }: { sourceId: string; requestHeaders: () => Headers }) {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError("");
    const params = new URLSearchParams({ section: "field-coverage", sourceId });
    void fetch(`/api/operations/sync-center?${params}`, { headers: requestHeaders(), signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "实际覆盖报告读取失败。");
      if (!controller.signal.aborted) setReport(body);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "读取失败。"); });
    return () => controller.abort();
  }, [sourceId, requestHeaders, refresh]);
  return <section aria-label="实际字段覆盖报告" className="space-y-3 rounded border border-border p-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">原件到业务数据的实际覆盖</h3><Button size="sm" variant="secondary" onClick={() => setRefresh(value => value + 1)}>刷新实际覆盖</Button></div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {!report && !error && <p role="status" className="text-xs text-muted">正在核对原件、持久化证据与业务查询…</p>}
    {report && <>
      <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">{[
        ["报告原件", report.archives.reportPayloads], ["有字段观察的原件", report.archives.withFieldObservations],
        ["观察字段 / 已映射", `${report.fields.observed} / ${report.fields.mapped}`], ["未映射字段", report.fields.unmapped],
        ["已保存业务行", report.business.storedRows], ["已发布业务行", report.business.publishedRows],
        ["业务查询可见行", report.query.visibleRows], ["有金额但缺币种", report.business.rowsWithAmountMissingCurrency],
        ["有通过批次的字段", report.persistence.fieldsWithPassedBatch], ["有差异批次的字段", report.persistence.fieldsWithFailedBatch],
      ].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 text-base font-semibold">{value}</dd></div>)}</dl>
      <p className="text-xs text-muted">实际出现的业务日期：{report.business.firstObservedBusinessDate ?? "未知"} 至 {report.business.lastObservedBusinessDate ?? "未知"}。起止日期不证明中间日期连续完整。</p>
      <p className="text-xs text-muted">批次证据可能覆盖重复行，不能作为全量业务行完成率。官方字段总数、全字段验收和真实 API 验收仍未完成；业务查询与统计分别读取，采集中数值可能变化。</p>
      {report.persistence.evidenceTruncated && <p role="alert" className="text-xs text-amber-700">批次证据已截断，仅展示本次读取范围。</p>}
      <p className="text-xs text-muted">最近已批准币种重解析：{report.settlementReplays.recent.length} 次{report.settlementReplays.truncated ? "（已截断）" : ""}。原件数量限本来源任务及已关联的卖家报告，旧共享档案可能未计入。</p>
    </>}
  </section>;
}
