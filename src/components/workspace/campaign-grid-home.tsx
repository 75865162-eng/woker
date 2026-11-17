"use client";

import { Download, EyeOff, ListChecks, Search, SlidersHorizontal, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationProgress } from "@/components/ui/operation-progress";
import type { LifecycleGroupId } from "@/lib/types";
import { CampaignGroupTable } from "./campaign-group-table";
import { CampaignBlockedDialog, CampaignHistoryDialog, CampaignKeywordDialog, CampaignRuleDialogs } from "./campaign-grid-dialogs";
import { useCampaignGridHome } from "./use-campaign-grid-home";

export function CampaignGridHome() {
  const model = useCampaignGridHome();
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <input ref={model.fileInputRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="hidden" aria-hidden onChange={event => void model.handleFileSelected(event.target.files?.[0])} />
      <input ref={model.groupingInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" aria-hidden onChange={event => void model.handleGroupingStatusSelected(event.target.files?.[0])} />
      <input ref={model.overallInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" multiple className="hidden" aria-hidden onChange={event => void model.handleOverallSelected(event.target.files)} />
      <Button onClick={() => model.fileInputRef.current?.click()}><UploadCloud className="h-4 w-4" />Upload Bulk</Button>
      <Button variant="secondary" onClick={() => model.groupingInputRef.current?.click()}><UploadCloud className="h-4 w-4" />上传分组</Button>
      <Button variant="secondary" onClick={model.handleDownloadGroupingStatus}><Download className="h-4 w-4" />下载分组状态</Button>
      <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-border px-3"><Search className="h-4 w-4 text-muted" /><input value={model.query} onChange={event => model.setQuery(event.target.value)} placeholder="Search campaign, ad group, or sheet" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
      <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted"><SlidersHorizontal className="h-4 w-4 text-brand" /><span>Product Cycle Filter</span><select value={model.activeLifecycleGroupId ?? ""} onChange={event => model.setActiveLifecycleGroup((event.target.value || undefined) as LifecycleGroupId | undefined)} className="bg-transparent font-bold text-foreground outline-none"><option value="">All</option><option value="launch">新品组</option><option value="mature">成熟组</option><option value="decline">衰退组</option><option value="clearance">清库存组</option></select></label>
      <Button variant="secondary" onClick={() => model.setBlockedModalOpen(true)}><EyeOff className="h-4 w-4" />屏蔽（{model.blockedCampaignIdentities.length}）</Button>
      {model.parseStatus === "parsing" ? <OperationProgress label="解析 Bulk 文件" progress={model.parseProgress} /> : null}
      {model.overallUploadProgress ? <OperationProgress label={model.overallUploadProgress.label} progress={model.overallUploadProgress.progress} /> : null}
      {model.ruleRunProgress ? <OperationProgress label={model.ruleRunProgress.label} progress={model.ruleRunProgress.progress} /> : null}
    </div>
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-muted">{model.filteredCampaigns.length} campaigns · Page {model.page} / {model.totalPages}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => model.setRulesCenterOpen(true)} title="打开规则中心"><ListChecks className="h-4 w-4" />规则中心</Button>
        <Button variant="secondary" onClick={model.selectOverallFilesForAllCampaigns}><UploadCloud className="h-4 w-4" />上传匹配所有广告组</Button>
        {model.pageItems.map((item, index) => item === "..." ? <span key={`ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">...</span> : <button key={item} type="button" onClick={() => { if (typeof item === "number") model.setPage(item); }} className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${model.page === item ? "bg-brand text-white" : "border border-border bg-surface text-muted hover:text-foreground"}`}>{item}</button>)}
      </div>
    </div>
    <CampaignGroupTable {...model} />
    <CampaignRuleDialogs model={model} />
    <CampaignBlockedDialog model={model} />
    <CampaignHistoryDialog model={model} />
    <CampaignKeywordDialog model={model} />
    {model.pagedCampaigns.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-10 text-center text-sm font-medium text-muted">No campaign groups match the current filters.</div> : null}
  </section>;
}
