"use client";

import { RotateCcw, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { RulesEditorShell } from "@/components/app-shell/lazy-workbenches";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { StandardDataTable } from "@/components/ui/table-variants";
import { lifecycleGroups } from "@/data/default-rules";
import { formatExportTime, lifecycleGroupLabel } from "./campaign-grid-home-utils";
import type { useCampaignGridHome } from "./use-campaign-grid-home";

type Model = ReturnType<typeof useCampaignGridHome>;

function CampaignDialog({ title, description, onClose, children, wide = false }: { title: string; description: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog open bare zIndex="modal" onClose={onClose}>
    <section className={`mx-auto flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop ${wide ? "max-w-7xl" : "max-w-4xl"}`} onClick={event => event.stopPropagation()}>
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3"><div><h2 className="text-base font-black text-foreground">{title}</h2><div className="mt-1 text-xs font-semibold text-muted">{description}</div></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded border border-border text-muted hover:text-foreground" title={`关闭${title}`}><X className="h-4 w-4" /></button></header>
      <div className="thin-scrollbar flex-1 space-y-3 overflow-auto p-4">{children}</div>
    </section>
  </Dialog>;
}

export function CampaignRuleDialogs({ model }: { model: Model }) {
  return <>
    {model.rulesCenterOpen ? <CampaignDialog title="规则中心" description="产品生命周期规则与 IF / THEN 编辑器。" onClose={() => model.setRulesCenterOpen(false)} wide><RulesEditorShell lifecycleGroups={lifecycleGroups} initialLifecycleId={model.activeLifecycleGroupId ?? lifecycleGroups[0].id} /></CampaignDialog> : null}
    {model.ruleModalLifecycleId ? <CampaignDialog title={`${lifecycleGroupLabel(model.ruleModalLifecycleId)}运行规则`} description={`当前系统中对该生命周期生效的全部启用规则，共 ${model.selectedLifecycleRules.length} 条，已按实际执行优先级排序。`} onClose={() => model.setRuleModalLifecycleId(null)}>
      <div className="mb-4 rounded-lg border border-border bg-surface-muted px-4 py-3 text-xs font-semibold leading-5 text-muted">优先级数字越小越先执行。BV 安全校验会按顺序连续校正竞价；随后执行常规投放规则，每条广告数据命中第一条常规规则后停止继续匹配。</div>
      <StandardDataTable ariaLabel="生命周期运行规则" rows={model.selectedLifecycleRules} getRowKey={rule => rule.id} columns={model.lifecycleRuleColumns} empty="当前生命周期没有启用的运行规则。" />
    </CampaignDialog> : null}
  </>;
}

export function CampaignHistoryDialog({ model }: { model: Model }) {
  if (!model.historyScopeIds) return null;
  return <CampaignDialog title="历史记录" description="查看该广告组或组合的导出文件、日期与运行数据，并可一键复用。" onClose={() => model.setHistoryScopeIds(null)}>
    {model.runHistoryRecords.length === 0 && model.historyRecords.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm font-semibold text-muted">该广告组还没有运行或导出历史。</div> : <>
      {model.runHistoryRecords.map(record => <article key={record.id} className="rounded-lg border border-border bg-surface-muted/50 p-4">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-foreground">规则运行</p><span className={`rounded px-2 py-1 text-label font-black ${record.exportedAt ? "bg-success-soft text-success-ink" : "bg-warning-soft text-warning-ink"}`}>{record.exportedAt ? "已导出" : "待导出"}</span></div><p className="mt-1 text-xs font-semibold text-muted">{formatExportTime(record.ranAt)} · {record.adjustmentDrafts.length} 行修改</p></div><Button size="sm" variant="secondary" onClick={() => { model.reuseRuleRunHistory(record.id); model.setHistoryScopeIds(null); }}><RotateCcw className="h-4 w-4" />复用</Button></div>
        <div className="mt-3 grid gap-2 text-xs font-semibold text-muted sm:grid-cols-2"><p className="truncate">Overall：{record.overallFileName ?? "-"}</p><p className="truncate">原 Bulk：{record.bulkFileName ?? "-"}</p><p className="truncate sm:col-span-2">广告组：{record.campaignGroupNames.join("，") || "-"}</p>{record.exportFileName ? <p className="truncate sm:col-span-2">导出文件：{record.exportFileName}</p> : null}</div>
      </article>)}
      {model.historyRecords.length > 0 ? <div className="border-t border-border pt-3"><p className="mb-2 text-xs font-black text-muted">旧版导出记录</p><div className="space-y-3">{model.historyRecords.map(record => <article key={record.id} className="rounded-lg border border-border p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-black text-foreground">{record.fileName}</p><p className="mt-1 text-xs font-semibold text-muted">{formatExportTime(record.exportedAt)}</p></div><Button size="sm" variant="secondary" onClick={() => { model.reuseExportHistory(record.id); model.setHistoryScopeIds(null); }}><RotateCcw className="h-4 w-4" />复用</Button></div></article>)}</div></div> : null}
    </>}
  </CampaignDialog>;
}

export function CampaignBlockedDialog({ model }: { model: Model }) {
  if (!model.blockedModalOpen) return null;
  return <CampaignDialog title="屏蔽名单" description="同时匹配广告活动名称和广告组名称的新数据会继续保持屏蔽。" onClose={() => model.setBlockedModalOpen(false)}>
    {model.blockedCampaignIdentities.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm font-semibold text-muted">当前没有屏蔽的广告组。</div> : model.blockedCampaignIdentities.map(identity => <article key={identity.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/50 p-4"><div className="min-w-0"><p className="truncate text-sm font-black text-foreground">{identity.adGroupName}</p><p className="mt-1 truncate text-xs font-semibold text-muted">广告活动：{identity.campaignName}</p></div><Button size="sm" variant="secondary" onClick={() => model.unblockCampaignIdentity(identity.id)} className="shrink-0"><RotateCcw className="h-4 w-4" />移出屏蔽</Button></article>)}
  </CampaignDialog>;
}

export function CampaignKeywordDialog({ model }: { model: Model }) {
  if (!model.detailCampaignGroupIds) return null;
  return <CampaignDialog title="Parsed Keyword Details" description={`Total ${model.detailRows.length.toLocaleString("zh-CN")} rows, filtered to ${model.sortedDetailRows.length.toLocaleString("zh-CN")} rows, page ${model.detailPage} / ${model.detailTotalPages}`} onClose={model.closeDetailRows} wide>
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex h-10 min-w-[240px] items-center gap-2 rounded-lg border border-border px-3"><Search className="h-4 w-4 text-muted" /><input value={model.detailQuery} onChange={event => model.setDetailQuery(event.target.value)} placeholder="Search keyword, ad group, sheet, or match type" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
      <select value={model.detailSortDirection} onChange={event => model.setDetailSortDirection(event.target.value as "asc" | "desc")} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground outline-none"><option value="asc">A-Z</option><option value="desc">Z-A</option></select>
      <Button variant="secondary" onClick={model.closeDetailRows}>Close</Button>
      <div className="flex flex-wrap items-center gap-2">{model.detailPageItems.map((item, index) => item === "..." ? <span key={`ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">...</span> : <button key={item} type="button" onClick={() => { if (typeof item === "number") model.setDetailPage(item); }} className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${model.detailPage === item ? "bg-brand text-white" : "border border-border bg-surface text-muted hover:text-foreground"}`}>{item}</button>)}</div>
    </div>
    {model.detailRows.length === 0 ? <div className="px-5 py-12 text-center text-sm font-medium text-muted">No parsed keyword rows are available for this card yet.</div> : <>
      <StandardDataTable ariaLabel="已解析关键词明细" rows={model.detailRowsPreview} getRowKey={row => row.id} columns={model.keywordDetailColumns} empty="暂无可解析的关键词行。" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-sm font-medium text-muted">Showing {model.detailRowsPreview.length.toLocaleString("zh-CN")} rows on this page</p><p className="text-sm font-medium text-muted">Pagination is pinned to the top-right of the modal</p></div>
    </>}
  </CampaignDialog>;
}
