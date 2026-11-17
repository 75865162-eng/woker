"use client";

import { ArrowUp, ArrowUpDown, Check, History, Play, RotateCcw, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignGroup } from "@/lib/types";
import type { useCampaignGridHome } from "./use-campaign-grid-home";
import { dragMimeType } from "./use-campaign-grid-home-model";

type Model = ReturnType<typeof useCampaignGridHome>;
type Props = Pick<Model, "toggleCampaignSort" | "campaignSortKey" | "renderCampaignSortIcon" | "lifecycleColumns" | "setRuleModalLifecycleId" | "pagedCampaigns" | "workspaceUnitByCampaignGroupId" | "campaignGroupById" | "getOverallFileName" | "exportHistoryCountByCampaignGroupId" | "activeCampaignGroupId" | "mergeCampaignGroupsIntoWorkspaceUnit" | "removeCampaignGroupFromWorkspaceUnit" | "openDetailRows" | "toggleLifecycle" | "selectOverallFiles" | "runScope" | "setHistoryScopeIds" | "blockCampaignGroup">;

export function CampaignGroupTable(model: Props) {
  const { toggleCampaignSort, campaignSortKey, renderCampaignSortIcon, lifecycleColumns, setRuleModalLifecycleId } = model;
  return <div className="overflow-x-auto rounded-lg border border-border bg-surface">
    <table className="w-full min-w-[1120px] border-collapse text-sm">
      <thead className="bg-surface-muted text-xs font-bold text-muted"><tr>
        <th className="w-32 border-b border-r border-border px-3 py-3 text-left">匹配 Sheet</th>
        <th className="w-44 border-b border-r border-border px-3 py-3 text-left"><button type="button" onClick={() => toggleCampaignSort("campaignName")} className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "campaignName" ? "text-brand" : ""}`} title="按广告活动名称排序">广告活动名称{renderCampaignSortIcon("campaignName")}</button></th>
        <th className="w-48 border-b border-r border-border px-3 py-3 text-left"><button type="button" onClick={() => toggleCampaignSort("adGroupName")} className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "adGroupName" ? "text-brand" : ""}`} title="按广告组名称排序">广告组名称{renderCampaignSortIcon("adGroupName")}</button></th>
        <th className="w-24 border-b border-r border-border px-3 py-3 text-right">Keyword</th>
        {lifecycleColumns.map(group => <th key={group.id} className="w-20 border-b border-r border-border px-2 py-3 text-center"><button type="button" onClick={() => setRuleModalLifecycleId(group.id)} className="font-bold hover:text-brand" title={`查看${group.label}运行规则`}>{group.label}</button></th>)}
        <th className="w-32 border-b border-r border-border px-3 py-3 text-center"><button type="button" onClick={() => toggleCampaignSort("overallCsv")} className={`inline-flex items-center gap-1.5 hover:text-foreground ${campaignSortKey === "overallCsv" ? "text-brand" : ""}`} title="已上传优先；再次点击恢复默认顺序">Overall{campaignSortKey === "overallCsv" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5" />}</button></th>
        <th className="w-20 border-b border-r border-border px-3 py-3 text-center">运行</th><th className="w-20 border-b border-r border-border px-3 py-3 text-center">历史</th><th className="w-20 border-b border-border px-3 py-3 text-center">屏蔽</th>
      </tr></thead>
      <tbody>{model.pagedCampaigns.map(campaign => <CampaignGroupRow key={campaign.id} campaign={campaign} model={model} />)}
        {model.pagedCampaigns.length === 0 ? <tr><td colSpan={12} className="px-4 py-12 text-center text-sm font-semibold text-muted">没有符合当前筛选条件的广告组。</td></tr> : null}
      </tbody>
    </table>
  </div>;
}

function CampaignGroupRow({ campaign, model }: { campaign: CampaignGroup; model: Props }) {
  const workspaceUnit = model.workspaceUnitByCampaignGroupId.get(campaign.id);
  const members = workspaceUnit ? workspaceUnit.campaignGroupIds.map(id => model.campaignGroupById.get(id)).filter((group): group is CampaignGroup => Boolean(group)) : [campaign];
  const scopeIds = workspaceUnit?.campaignGroupIds ?? [campaign.id];
  const overallFileName = model.getOverallFileName([campaign.id]);
  const lifecycleIds = scopeIds.map(id => model.campaignGroupById.get(id)?.lifecycleGroupId);
  const lifecycleReady = !workspaceUnit || (lifecycleIds.every(Boolean) && new Set(lifecycleIds).size === 1);
  return <tr draggable onDragStart={event => { event.dataTransfer.setData(dragMimeType, campaign.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => { event.preventDefault(); const source = event.dataTransfer.getData(dragMimeType); if (source && source !== campaign.id) model.mergeCampaignGroupsIntoWorkspaceUnit(source, campaign.id); }} className={`${workspaceUnit ? "bg-surface-muted" : "bg-surface"} ${model.activeCampaignGroupId === campaign.id ? "outline outline-2 -outline-offset-2 outline-brand" : ""} hover:bg-info-soft/60`}>
    <td className="border-b border-r border-border px-3 py-2.5 font-semibold text-muted">{campaign.sheetName ?? "Bulk"}</td>
    <td className="border-b border-r border-border px-3 py-2.5 font-semibold text-foreground">{campaign.campaignName}</td>
    <td className="border-b border-r border-border px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-foreground">{campaign.adGroupName}</span>{workspaceUnit ? <button type="button" onClick={event => { event.stopPropagation(); model.removeCampaignGroupFromWorkspaceUnit(campaign.id); }} className="grid h-7 w-7 shrink-0 place-items-center rounded border border-border bg-surface text-muted hover:border-brand hover:text-brand" title="移出组合"><RotateCcw className="h-3.5 w-3.5" /></button> : null}</div></td>
    <td className="border-b border-r border-border px-3 py-2.5 text-right font-bold tabular-nums"><button type="button" onClick={event => model.openDetailRows(event, scopeIds)} className="text-brand hover:underline" title="查看关键词明细">{campaign.keywordCount.toLocaleString("zh-CN")}</button></td>
    {model.lifecycleColumns.map(column => <td key={column.id} className="border-b border-r border-border p-1.5 text-center"><button type="button" aria-label={`${campaign.adGroupName} ${column.label}`} aria-pressed={campaign.lifecycleGroupId === column.id} onClick={event => { event.stopPropagation(); model.toggleLifecycle(campaign.id, column.id); }} className={`mx-auto grid h-8 w-8 place-items-center rounded border transition-colors ${campaign.lifecycleGroupId === column.id ? "border-brand bg-brand text-white" : "border-border bg-surface text-transparent hover:border-brand"}`}><Check className="h-4 w-4" /></button></td>)}
    <td className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle"><div className="flex flex-col items-center gap-1.5"><Button size="sm" variant="secondary" onClick={event => { event.stopPropagation(); model.selectOverallFiles([campaign.id]); }} className="h-8 px-2"><UploadCloud className="h-4 w-4" />上传</Button>{overallFileName ? <span className="max-w-28 truncate text-label font-semibold text-success" title={overallFileName}>{overallFileName}</span> : null}</div></td>
    {members[0]?.id === campaign.id ? <td rowSpan={members.length} className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle"><button type="button" onClick={event => { event.stopPropagation(); void model.runScope(campaign.id, workspaceUnit?.id); }} className={`mx-auto grid h-9 w-9 place-items-center rounded border bg-surface ${lifecycleReady ? "border-border text-brand hover:border-brand hover:bg-info-soft" : "border-warning-ink/30 text-warning-ink hover:bg-warning-soft"}`} title={lifecycleReady ? "运行规则" : "组合内生命周期必须一致后才能运行"}><Play className="h-4 w-4 fill-current" /></button></td> : null}
    <td className="border-b border-r border-border bg-inherit px-2 py-2 text-center align-middle"><div className="flex flex-col items-center gap-1"><button type="button" onClick={event => { event.stopPropagation(); model.setHistoryScopeIds([campaign.id]); }} className="mx-auto inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"><History className="h-4 w-4" />历史</button><span className="text-label font-bold tabular-nums text-muted">已导出 {model.exportHistoryCountByCampaignGroupId.get(campaign.id) ?? 0}</span></div></td>
    <td className="border-b border-border p-1.5 text-center"><button type="button" aria-label={`屏蔽 ${campaign.campaignName} ${campaign.adGroupName}`} onClick={() => model.blockCampaignGroup(campaign.id)} className="mx-auto grid h-8 w-8 place-items-center rounded border border-border bg-surface text-transparent transition-colors hover:border-danger hover:text-danger" title="加入屏蔽名单"><Check className="h-4 w-4" /></button></td>
  </tr>;
}
