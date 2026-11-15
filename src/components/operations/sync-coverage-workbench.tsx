"use client";
import { useEffect, useState } from "react";
import { ActualFieldCoveragePanel } from "./actual-field-coverage-panel";
import { Button } from "@/components/ui/button";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";

type Coverage = {
  observedAt: string; universe: string; evidenceTruncated: boolean;
  summary: { registeredDomains: number; completedDomains: number; domainCoveragePercent: number | null; complete: boolean };
  domains: Array<{ resource: string; name: string; status: string; configuredSources: number; expectedSources: number | null; completedSources: number }>;
  sources: Array<{ sourceId: string; resource: string; marketplaceId: string; status: string; visibleRows: number; snapshotComplete: boolean | null; history: { applicable: boolean; percent: number | null; gapCount: number | null } }>;
};
type SkillReadiness = {
  skills: Array<{
    skill: string; status: string; contractStatus: string; fieldReviewRequired: boolean; missingTools: string[];
    endToEndStatus: string; evidence: string;
    requirements: Array<{ table: string; fields: readonly string[]; level: string; available: boolean; missingReason: string | null; unsupportedFields: string[] }>;
  }>;
};
const labels: Record<string, string> = { CURRENT: "当前完整", STALE: "已过期", PARTIAL: "部分完成", INCOMPLETE: "未完成", IN_PROGRESS: "采集中", MISSING_SOURCE: "缺少来源", NOT_PUBLISHED: "尚未发布", COMPLETE: "完成", FAILED: "失败", BLOCKED: "阻断", PARTIAL_SUCCESS: "部分成功", PAUSED: "已暂停", ATTRIBUTION_PENDING: "归属待核验", AUTHORIZATION_BLOCKED: "授权阻断", ACCESS_RESTRICTED: "权限限制", DERIVED_FROM_ORDERS_DETAILS: "复用订单详情", ADAPTER_NOT_IMPLEMENTED: "适配器未完成" };

/** Read-only view of the same evidence returned by MCP data_sync_status. */
export function SyncCoverageWorkbench({ sellerAccountId, marketplaceId, requestHeaders, canConfigure = false, showSkillReadiness = false }: { sellerAccountId: string; marketplaceId: string; requestHeaders: () => Headers; canConfigure?: boolean; showSkillReadiness?: boolean }) {
  const [selected, setSelected] = useState("");
  const [coverage, setCoverage] = useState<Coverage | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [readiness, setReadiness] = useState<SkillReadiness | null>(null), [readinessError, setReadinessError] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("reimbursement-recovery");
  useEffect(() => {
    const controller = new AbortController();
    if (!showSkillReadiness) return () => controller.abort();
    const params = new URLSearchParams({ section: "coverage", ...(sellerAccountId ? { sellerAccountId } : {}), ...(marketplaceId ? { marketplaceId } : {}) });
    setError(""); setCoverage(null); setSelected("");
    void fetch(`/api/operations/sync-center?${params}`, { headers: requestHeaders(), signal: controller.signal, cache: "no-store" }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "覆盖状态读取失败。"); if (!controller.signal.aborted) setCoverage(value); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); });
    return () => controller.abort();
  }, [sellerAccountId, marketplaceId, requestHeaders, revision, showSkillReadiness]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ section: "skill-readiness", ...(sellerAccountId ? { sellerAccountId } : {}), ...(marketplaceId ? { marketplaceId } : {}) });
    setReadiness(null); setReadinessError("");
    if (!sellerAccountId || !marketplaceId) { setReadinessError("请选择单个账号和站点后查看 Skill 数据就绪状态。"); return () => controller.abort(); }
    void fetch(`/api/operations/sync-center?${params}`, { headers: requestHeaders(), signal: controller.signal, cache: "no-store" }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "Skill 就绪状态读取失败。");
      if (!controller.signal.aborted) setReadiness(value);
    }).catch(e => { if (!controller.signal.aborted) setReadinessError(e instanceof Error ? e.message : "读取失败。"); });
    return () => controller.abort();
  }, [sellerAccountId, marketplaceId, requestHeaders, revision]);
  const activeSkill = readiness?.skills.find(skill => skill.skill === selectedSkill) ?? readiness?.skills[0];
  const domainColumns: DataTableColumn<Coverage["domains"][number]>[] = [
    { key: "domain", header: "数据域", render: (d) => d.name },
    { key: "configured", header: "配置来源 / 预期", render: (d) => `${d.configuredSources} / ${d.expectedSources ?? "受限"}` },
    { key: "completed", header: "已完成来源", numeric: true, render: (d) => String(d.completedSources) },
    { key: "status", header: "真实状态", render: (d) => labels[d.status] ?? d.status },
  ];
  const sourceColumns: DataTableColumn<Coverage["sources"][number]>[] = [
    { key: "resource", header: "数据域 / 站点", render: (s) => `${s.resource} / ${s.marketplaceId}` },
    { key: "status", header: "状态", render: (s) => labels[s.status] ?? s.status },
    { key: "visibleRows", header: "已发布行数", numeric: true, render: (s) => String(s.visibleRows) },
    { key: "history", header: "历史覆盖", render: (s) => s.history.applicable ? s.history.percent === null ? "未知" : `${s.history.percent}%` : "当前快照，不适用" },
    { key: "gap", header: "缺口数", render: (s) => String(s.history.gapCount ?? "未知") },
  ];
  const requirementColumns: DataTableColumn<SkillReadiness["skills"][number]["requirements"][number]>[] = [
    { key: "table", header: "数据表", render: (r) => r.table },
    { key: "level", header: "级别", render: (r) => r.level },
    { key: "fields", header: "所需字段", render: (r) => r.fields.join(", ") },
    { key: "status", header: "状态 / 缺失字段", render: (r) => r.available ? "已满足" : `${r.missingReason ?? "未知"}${r.unsupportedFields.length ? ` · ${r.unsupportedFields.join(", ")}` : ""}` },
  ];
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">全数据域覆盖与真实完成状态</h2><Button size="sm" variant="secondary" onClick={() => setRevision(v => v + 1)}>刷新覆盖状态</Button></div>
    <p className="text-xs text-muted">按系统已登记的 SP-API 数据域统计。历史窗口只累计完整成功证据，失败缺口、站点归属待核验及未实现能力均不计为完成。官方全部 API 与字段覆盖尚未核实。</p>
    {error && <p role="alert" className="text-xs text-danger-ink">{error}</p>}
    {!coverage && !error && <p role="status" className="text-xs text-muted">正在读取 PostgreSQL 覆盖证据…</p>}
    {coverage && <><p className="text-xs">已完成 {coverage.summary.completedDomains} / {coverage.summary.registeredDomains} 个登记数据域（{coverage.summary.domainCoveragePercent ?? "未知"}%） · {coverage.summary.complete ? "本范围已完成" : "本范围尚未全部完成"} · {new Date(coverage.observedAt).toLocaleString("zh-CN")}</p>
      {coverage.evidenceTruncated && <p role="alert" className="text-xs text-warning-ink">历史证据超过本次查询容量，历史百分比显示为未知。</p>}
      <StandardDataTable ariaLabel="数据域覆盖状态" rows={coverage.domains} getRowKey={(d) => d.resource} columns={domainColumns} empty="本范围没有登记的 SP-API 数据域。" />
      <details><summary className="cursor-pointer text-xs">逐来源历史覆盖与缺口</summary><StandardDataTable ariaLabel="逐来源历史覆盖与缺口" rows={coverage.sources} getRowKey={(s) => s.sourceId} columns={sourceColumns} empty="本范围没有已发布的来源覆盖记录。" /></details></>}
    {showSkillReadiness && <section className="space-y-3 border-t border-border pt-3" aria-label="Skill 数据就绪">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Skill 数据依赖与就绪状态</h3><label className="text-xs">Skill<select aria-label="选择 Skill" className="ml-2 rounded border border-border bg-surface p-2" value={selectedSkill} onChange={event => setSelectedSkill(event.target.value)}>
        {(readiness?.skills ?? []).map(skill => <option key={skill.skill} value={skill.skill}>{skill.skill}</option>)}
      </select></label></div>
      <p className="text-xs text-muted">工具依赖从 116 个已发布 Skill 目录提取。三项首批验收 Skill 有字段级合同草案，仍待逐项核实；其余字段依赖待审核。目录/数据就绪不代表 Skill 端到端已验证。</p>
      {readinessError && <p role="alert" className="text-xs text-danger-ink">{readinessError}</p>}
      {!readiness && !readinessError && <p role="status" className="text-xs text-muted">正在读取 Skill 数据依赖…</p>}
      {activeSkill && <><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>状态：{activeSkill.status}</span><span>合同：{activeSkill.contractStatus}</span><span>端到端：{activeSkill.endToEndStatus}</span><span>待审核字段：{activeSkill.fieldReviewRequired ? "是" : "否"}</span></div>
        {activeSkill.missingTools.length > 0 && <p className="text-xs text-warning-ink">服务端未接入工具（当前 MCP 凭证权限另行核验）：{activeSkill.missingTools.join("、")}</p>}
        <StandardDataTable ariaLabel="Skill 字段级依赖" rows={activeSkill.requirements} getRowKey={(r) => `${r.table}:${r.level}:${r.fields.join(",")}`} columns={requirementColumns} empty="尚无字段级依赖审核记录。" /></>}
    </section>}
    {canConfigure && coverage && <div className="space-y-3"><label className="block text-xs">查看实际字段覆盖（管理员）<select aria-label="实际覆盖来源" className="ml-2 rounded border border-border bg-surface p-2" value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">选择报告来源</option>{coverage.sources.filter(source => ["settlements", "reimbursements", "inventory_age", "inventory_events"].includes(source.resource)).map(source => <option key={source.sourceId} value={source.sourceId}>{source.resource} / {source.marketplaceId} / {source.sourceId.slice(0, 8)}</option>)}
    </select></label>{selected && <ActualFieldCoveragePanel key={`${sellerAccountId}:${marketplaceId}:${selected}`} sourceId={selected} requestHeaders={requestHeaders} />}</div>}
  </section>;
}
