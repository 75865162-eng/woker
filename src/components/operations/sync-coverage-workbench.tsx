"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Coverage = {
  observedAt: string; universe: string; evidenceTruncated: boolean;
  summary: { registeredDomains: number; completedDomains: number; domainCoveragePercent: number | null; complete: boolean };
  domains: Array<{ resource: string; name: string; status: string; configuredSources: number; expectedSources: number | null; completedSources: number }>;
  sources: Array<{ sourceId: string; resource: string; marketplaceId: string; status: string; visibleRows: number; snapshotComplete: boolean | null; history: { applicable: boolean; percent: number | null; gapCount: number | null } }>;
};
const labels: Record<string, string> = { CURRENT: "当前完整", STALE: "已过期", PARTIAL: "部分完成", INCOMPLETE: "未完成", IN_PROGRESS: "采集中", MISSING_SOURCE: "缺少来源", NOT_PUBLISHED: "尚未发布", COMPLETE: "完成", FAILED: "失败", BLOCKED: "阻断", PARTIAL_SUCCESS: "部分成功", PAUSED: "已暂停", ATTRIBUTION_PENDING: "归属待核验", AUTHORIZATION_BLOCKED: "授权阻断", ACCESS_RESTRICTED: "权限限制", DERIVED_FROM_ORDERS_DETAILS: "复用订单详情", ADAPTER_NOT_IMPLEMENTED: "适配器未完成" };

/** Read-only view of the same evidence returned by MCP data_sync_status. */
export function SyncCoverageWorkbench({ sellerAccountId, marketplaceId, requestHeaders }: { sellerAccountId: string; marketplaceId: string; requestHeaders: () => Headers }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ section: "coverage", ...(sellerAccountId ? { sellerAccountId } : {}), ...(marketplaceId ? { marketplaceId } : {}) });
    setError(""); setCoverage(null);
    void fetch(`/api/operations/sync-center?${params}`, { headers: requestHeaders(), signal: controller.signal, cache: "no-store" }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "覆盖状态读取失败。"); if (!controller.signal.aborted) setCoverage(value); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); });
    return () => controller.abort();
  }, [sellerAccountId, marketplaceId, requestHeaders, revision]);
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">全数据域覆盖与真实完成状态</h2><Button size="sm" variant="secondary" onClick={() => setRevision(v => v + 1)}>刷新覆盖状态</Button></div>
    <p className="text-xs text-muted">按系统已登记的 SP-API 数据域统计。历史窗口只累计完整成功证据，失败缺口、站点归属待核验及未实现能力均不计为完成。官方全部 API 与字段覆盖尚未核实。</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {!coverage && !error && <p role="status" className="text-xs text-muted">正在读取 PostgreSQL 覆盖证据…</p>}
    {coverage && <><p className="text-xs">已完成 {coverage.summary.completedDomains} / {coverage.summary.registeredDomains} 个登记数据域（{coverage.summary.domainCoveragePercent ?? "未知"}%） · {coverage.summary.complete ? "本范围已完成" : "本范围尚未全部完成"} · {new Date(coverage.observedAt).toLocaleString("zh-CN")}</p>
      {coverage.evidenceTruncated && <p role="alert" className="text-xs text-amber-700">历史证据超过本次查询容量，历史百分比显示为未知。</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead><tr>{["数据域", "配置来源 / 预期", "已完成来源", "真实状态"].map(title => <th className="border-b p-2" key={title}>{title}</th>)}</tr></thead><tbody>{coverage.domains.map(domain => <tr key={domain.resource}><td className="border-b p-2">{domain.name}</td><td className="border-b p-2">{domain.configuredSources} / {domain.expectedSources ?? "受限"}</td><td className="border-b p-2">{domain.completedSources}</td><td className="border-b p-2">{labels[domain.status] ?? domain.status}</td></tr>)}</tbody></table></div>
      <details><summary className="cursor-pointer text-xs">逐来源历史覆盖与缺口</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr>{["数据域 / 站点", "状态", "已发布行数", "历史覆盖", "缺口数"].map(title => <th className="border-b p-2" key={title}>{title}</th>)}</tr></thead><tbody>{coverage.sources.map(source => <tr key={source.sourceId}><td className="border-b p-2">{source.resource} / {source.marketplaceId}</td><td className="border-b p-2">{labels[source.status] ?? source.status}</td><td className="border-b p-2">{source.visibleRows}</td><td className="border-b p-2">{source.history.applicable ? source.history.percent === null ? "未知" : `${source.history.percent}%` : "当前快照，不适用"}</td><td className="border-b p-2">{source.history.gapCount ?? "未知"}</td></tr>)}</tbody></table></div></details></>}
  </section>;
}
