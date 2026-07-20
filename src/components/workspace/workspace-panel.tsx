"use client";

import Link from "next/link";
import { useRef } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { AdjustmentTable } from "@/components/workspace/adjustment-table";
import { PendingDraftQueue } from "@/components/workspace/pending-draft-queue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { defaultRules, lifecycleGroups } from "@/data/mock-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { workspacePanelAnchorId } from "@/lib/workspace-events";

export function WorkspacePanel() {
  const overallAdDataInputRef = useRef<HTMLInputElement>(null);
  const {
    campaignGroups,
    workspaceUnits,
    activeCampaignGroupId,
    activeWorkspaceUnitId,
    activeLifecycleGroupId,
    workspaceMode,
    openTabIds,
    setActiveCampaignGroup,
    openCampaignGroup,
    setActiveWorkspaceUnit,
    overallAdDataFileName,
    overallAdDataRows,
    overallAdDataStatus,
    overallAdDataError,
    overallAdDataMatchSummary,
    persistenceStatus,
    persistenceError,
    clearPersistedWorkspace,
    ingestOverallAdDataCsv,
    runRulesForActiveWorkspaceUnit,
  } = useWorkspaceStore();
  const activeGroup = campaignGroups.find((group) => group.id === activeCampaignGroupId);
  const activeWorkspaceUnit = workspaceUnits.find((unit) => unit.id === activeWorkspaceUnitId);
  const activeLifecycleGroup =
    workspaceMode === "lifecycle"
      ? lifecycleGroups.find((group) => group.id === activeLifecycleGroupId)
      : lifecycleGroups.find((group) => group.id === activeGroup?.lifecycleGroupId);
  const workspaceUnitGroups = activeWorkspaceUnit
    ? campaignGroups.filter((group) => activeWorkspaceUnit.campaignGroupIds.includes(group.id))
    : [];
  const scopedGroups =
    workspaceMode === "workspace-unit"
      ? workspaceUnitGroups
      : workspaceMode === "lifecycle" && activeLifecycleGroupId
      ? campaignGroups.filter((group) => group.lifecycleGroupId === activeLifecycleGroupId)
      : activeGroup
        ? [activeGroup]
        : [];
  const openTabs = workspaceMode === "lifecycle" ? scopedGroups : campaignGroups.filter((group) => openTabIds.includes(group.id));
  const activeRules = activeLifecycleGroup
    ? defaultRules.filter((rule) => rule.lifecycleGroupId === activeLifecycleGroup.id && rule.enabled)
    : [];
  const scopedKeywordCount = scopedGroups.reduce((sum, group) => sum + group.keywordCount, 0);
  const overallTotals = overallAdDataRows
    .filter((row) => row.matchStatus === "matched")
    .reduce(
      (totals, row) => ({
        spend: totals.spend + row.spend,
        sales: totals.sales + row.sales,
        clicks: totals.clicks + row.clicks,
      }),
      { spend: 0, sales: 0, clicks: 0 },
    );
  const overallAcos = overallTotals.sales > 0 ? (overallTotals.spend / overallTotals.sales) * 100 : undefined;
  const overallCpc = overallTotals.clicks > 0 ? overallTotals.spend / overallTotals.clicks : undefined;
  const persistenceLabel =
    persistenceStatus === "loading"
      ? "正在恢复本地工作区"
      : persistenceStatus === "saving"
        ? "正在自动保存"
        : persistenceStatus === "saved"
          ? "已自动保存"
          : persistenceStatus === "failed"
            ? "自动保存异常"
            : "本地保存已就绪";

  async function handleOverallAdDataSelected(file?: File) {
    if (!file) {
      return;
    }

    if (!/\.csv$/i.test(file.name)) {
      window.alert("Overall 所有日期广告数据仅支持 .csv 文件。");
      return;
    }

    try {
      const scopeCampaignGroupIds =
        workspaceMode === "lifecycle" ? scopedGroups.map((group) => group.id) : activeGroup ? [activeGroup.id] : [];

      if (scopeCampaignGroupIds.length === 0) {
        window.alert("请先打开要调整的广告组，或进入某个产品周期分组后再上传 Overall 所有日期广告数据。");
        return;
      }

      ingestOverallAdDataCsv(file.name, await file.text(), scopeCampaignGroupIds);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "读取 Overall 所有日期广告数据失败。");
    } finally {
      if (overallAdDataInputRef.current) {
        overallAdDataInputRef.current.value = "";
      }
    }
  }

  return (
    <div id={workspacePanelAnchorId} className="min-w-0 flex-1 scroll-mt-24 space-y-5">
      <div className="thin-scrollbar flex gap-2 overflow-auto rounded-lg border border-border bg-white p-2">
        {openTabs.length === 0 ? (
          <span className="px-3 py-2 text-sm font-semibold text-muted">请选择广告组或产品周期分组</span>
        ) : (
          openTabs.map((group) => (
            <button
              key={group.id}
              onClick={() => setActiveCampaignGroup(group.id)}
              onDoubleClick={() => openCampaignGroup(group.id)}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-bold transition-colors ${
                group.id === activeCampaignGroupId ? "bg-brand text-white" : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              {group.adGroupName}
            </button>
          ))
        )}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>
              {workspaceMode === "workspace-unit"
                ? activeWorkspaceUnit?.name ?? "组合工作单元"
                : workspaceMode === "lifecycle"
                ? `${activeLifecycleGroup?.name ?? "产品周期分组"}工作区`
                : activeGroup?.adGroupName ?? "等待选择广告组"}
            </CardTitle>
            <p className="mt-1 text-xs font-medium text-muted">
              {workspaceMode === "workspace-unit"
                ? `当前组合单元包含 ${workspaceUnitGroups.length} 个广告组，合计 ${scopedKeywordCount.toLocaleString("zh-CN")} 条关键词。`
                : workspaceMode === "lifecycle"
                ? `仅展示该产品周期内 ${scopedGroups.length} 个广告组，合计 ${scopedKeywordCount.toLocaleString("zh-CN")} 条关键词。`
                : activeGroup?.campaignName ?? "点击上方广告组卡片后，在这里处理该组广告数据、Overall 数据与规则结果。"}
            </p>
          </div>
          <div>
            <input
              ref={overallAdDataInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void handleOverallAdDataSelected(event.target.files?.[0])}
            />
            <Button onClick={() => overallAdDataInputRef.current?.click()}>
              <UploadCloud className="h-4 w-4" />
              上传所有日期广告数据.csv
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
            <div className="text-xs font-semibold text-muted">
              <span className={persistenceStatus === "failed" ? "text-danger" : "text-success"}>{persistenceLabel}</span>
              <span className="ml-2">刷新页面后会自动恢复产品周期分组、Overall 数据和草稿勾选。</span>
              {persistenceError && <span className="ml-2 text-danger">{persistenceError}</span>}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (window.confirm("确定清空本地保存并恢复默认演示数据吗？")) {
                  void clearPersistedWorkspace();
                }
              }}
            >
              清空本地保存
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-surface-muted p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">
                  {activeLifecycleGroup ? `${activeLifecycleGroup.name} · ${activeRules.length} 条启用规则` : "未分配产品周期分组"}
                </p>
                <p className="mt-1 text-xs font-medium text-muted">
                  {workspaceMode === "workspace-unit"
                    ? "运行规则时，会按组合单元内的多个广告组统一生成草稿，但导出时仍按原广告组分别写回。"
                    : workspaceMode === "lifecycle"
                    ? "运行规则时，会依次为该产品周期组内的每个广告组生成优化草稿。"
                    : activeLifecycleGroup
                      ? "当前为单广告组视图，只运行该广告组所属产品周期规则。"
                      : "请先把左侧广告组拖入新品组、成熟期组、衰退期组或清库存组。"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
              {activeRules.slice(0, 4).map((rule) => (
                  <Link
                    key={rule.id}
                    href={`/rules?lifecycle=${activeLifecycleGroup?.id ?? rule.lifecycleGroupId}`}
                    className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-muted transition-colors hover:border-brand hover:text-foreground"
                  >
                    {rule.name}
                  </Link>
                ))}
                {workspaceMode === "workspace-unit" && activeWorkspaceUnit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setActiveWorkspaceUnit(activeWorkspaceUnit.id);
                      runRulesForActiveWorkspaceUnit();
                    }}
                  >
                    运行组合单元规则
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-foreground">Overall 所有日期广告数据</p>
                <p className="text-xs font-medium text-muted">
                  使用上方主按钮上传 CSV，系统按“关键词 + 匹配类型”同时一致来匹配 Bulk 行。
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-semibold text-muted sm:grid-cols-2 xl:grid-cols-8">
              <span className="rounded-md bg-surface-muted px-3 py-2">
                状态：
                {overallAdDataStatus === "idle"
                  ? "未上传"
                  : overallAdDataStatus === "matched"
                    ? "已匹配"
                    : overallAdDataStatus === "failed"
                      ? "匹配异常"
                      : "解析中"}
              </span>
              <span className="rounded-md bg-surface-muted px-3 py-2">数据行：{overallAdDataMatchSummary.totalRows}</span>
              <span className="rounded-md bg-surface-muted px-3 py-2">范围广告组：{overallAdDataMatchSummary.scopedCampaignGroups}</span>
              <span className="rounded-md bg-surface-muted px-3 py-2">已匹配：{overallAdDataMatchSummary.matchedRows}</span>
              <span className="rounded-md bg-surface-muted px-3 py-2">未匹配：{overallAdDataMatchSummary.unmatchedRows}</span>
              <span className="rounded-md bg-surface-muted px-3 py-2">重名冲突：{overallAdDataMatchSummary.ambiguousRows}</span>
              <span className="rounded-md bg-surface-muted px-3 py-2">
                整体 ACOS：{overallAcos === undefined ? "-" : `${overallAcos.toFixed(1)}%`}
              </span>
              <span className="rounded-md bg-surface-muted px-3 py-2">
                整体 CPC：{overallCpc === undefined ? "-" : `$${overallCpc.toFixed(2)}`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
              {overallAdDataFileName && (
                <span className="inline-flex items-center gap-1 text-muted">
                  <FileSpreadsheet className="h-4 w-4 text-brand" />
                  {overallAdDataFileName}
                </span>
              )}
              {overallAdDataStatus === "matched" && (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  已匹配 {overallAdDataMatchSummary.matchedCampaignGroups} 个广告组
                </span>
              )}
              {overallAdDataError && (
                <span className="inline-flex items-center gap-1 text-danger">
                  <AlertCircle className="h-4 w-4" />
                  {overallAdDataError}
                </span>
              )}
            </div>
          </div>
          <AdjustmentTable />
          <PendingDraftQueue />
        </CardContent>
      </Card>
    </div>
  );
}
