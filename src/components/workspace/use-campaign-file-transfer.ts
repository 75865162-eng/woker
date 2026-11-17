"use client";

import { useEffect, useRef, useState } from "react";
import { readWorkspaceScope } from "@/lib/workspace/workspace-scope-store";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CampaignGroup, WorkspaceUnit } from "@/lib/types";
import { countMatchedOverallKeywords, downloadGroupingStatusWorkbook, readGroupingStatusFile, readOverallImportFile, sameScope } from "./campaign-grid-home-utils";

export function useCampaignFileTransfer(campaignGroups: CampaignGroup[], workspaceUnits: WorkspaceUnit[]) {
  const groupingInputRef = useRef<HTMLInputElement>(null);
  const overallInputRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<string[]>([]);
  const generation = useRef(0);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const reset = () => { generation.current++; scopeRef.current = []; if (completionTimer.current) clearTimeout(completionTimer.current); setOverallUploadProgress(null); };
    const invalidate = () => { generation.current++; if (completionTimer.current) clearTimeout(completionTimer.current); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => { invalidate(); window.removeEventListener(workspaceScopeChangedEventName, reset); };
  }, []);
  const [overallUploadProgress, setOverallUploadProgress] = useState<{ label: string; progress: number } | null>(null);
  const { importGroupingStatusCsv, ingestOverallAdDataCsvFiles, activateOverallAdDataForScope, openCampaignGroup, setActiveWorkspaceUnit } = useWorkspaceStore();
  async function handleDownloadGroupingStatus() {
    const unitByCampaign = new Map<string, string>();
    workspaceUnits.forEach(unit => unit.campaignGroupIds.forEach(id => unitByCampaign.set(id, unit.name)));
    await downloadGroupingStatusWorkbook([
      ["campaignGroupId", "sheetName", "campaignName", "adGroupName", "lifecycleGroup", "workspaceUnit"],
      ...campaignGroups.map(group => [group.id, group.sheetName ?? "", group.campaignName, group.adGroupName, group.lifecycleGroupId ?? "", unitByCampaign.get(group.id) ?? ""]),
    ]);
  }
  async function handleGroupingStatusSelected(file: File | undefined) {
    if (!file) return;
    const id = ++generation.current;
    const scope = JSON.stringify(readWorkspaceScope());
    const text = await readGroupingStatusFile(file);
    if (id !== generation.current || scope !== JSON.stringify(readWorkspaceScope())) return;
    const result = importGroupingStatusCsv(file.name, text);
    window.alert(`已导入 ${result.importedRows} 个广告组，生成 ${result.workspaceUnitCount} 个工作区分组。`);
    if (groupingInputRef.current) groupingInputRef.current.value = "";
  }
  async function handleOverallSelected(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0 || scopeRef.current.length === 0) return;
    const unsupported = files.filter(file => !/\.(csv|xlsx|xls)$/i.test(file.name));
    if (unsupported.length > 0) { window.alert(`Overall 数据仅支持 CSV / Excel：${unsupported.map(file => file.name).join("、")}`); return; }
    const id = ++generation.current;
    const scope = JSON.stringify(readWorkspaceScope());
    const active = () => id === generation.current && scope === JSON.stringify(readWorkspaceScope());
    if (completionTimer.current) clearTimeout(completionTimer.current);
    try {
      const ids = [...scopeRef.current];
      setOverallUploadProgress({ label: "读取 Overall 文件", progress: 20 });
      const overallFiles = await Promise.all(files.map(readOverallImportFile));
      if (!active()) return;
      setOverallUploadProgress({ label: "匹配广告组数据", progress: 65 });
      ingestOverallAdDataCsvFiles(overallFiles, ids);
      setOverallUploadProgress({ label: "更新 Overall 卡片", progress: 85 });
      activateOverallAdDataForScope(ids);
      const state = useWorkspaceStore.getState();
      const matchedKeywordCount = countMatchedOverallKeywords(state.overallAdDataRows);
      if (ids.length === 1) openCampaignGroup(ids[0]);
      else {
        const unit = workspaceUnits.find(unit => sameScope(unit.campaignGroupIds, ids));
        if (unit) setActiveWorkspaceUnit(unit.id);
      }
      setOverallUploadProgress({ label: "Overall 上传完成", progress: 100 });
      completionTimer.current = setTimeout(() => { if (active()) setOverallUploadProgress(null); }, 1200);
      window.alert(`Overall 文件匹配完成：命中 ${state.overallAdDataMatchSummary.matchedCampaignGroups} 个广告组，${matchedKeywordCount} 个关键词/投放。`);
    } catch (error) {
      if (!active()) return;
      setOverallUploadProgress(null);
      window.alert(error instanceof Error ? error.message : "Overall 数据解析失败。");
    }
    if (overallInputRef.current) overallInputRef.current.value = "";
  }
  function selectOverallFiles(ids: string[]) { scopeRef.current = ids; overallInputRef.current?.click(); }
  function selectOverallFilesForAllCampaigns() {
    const ids = campaignGroups.map(group => group.id);
    if (ids.length === 0) { window.alert("请先上传 Bulk 文件并解析出广告组，再上传匹配所有广告组的 Overall 文件。"); return; }
    selectOverallFiles(ids);
  }
  return { groupingInputRef, overallInputRef, overallUploadProgress, handleDownloadGroupingStatus, handleGroupingStatusSelected, handleOverallSelected, selectOverallFiles, selectOverallFilesForAllCampaigns };
}
