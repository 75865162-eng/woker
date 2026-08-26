"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";
import { AdjustmentTable } from "@/components/workspace/adjustment-table";
import { PendingDraftQueue } from "@/components/workspace/pending-draft-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { defaultRules, lifecycleGroups } from "@/data/mock-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OverallAdDataRow } from "@/lib/types";
import { workspacePanelAnchorId } from "@/lib/workspace-events";

type OverallDetailView = "scope" | "processable" | "unmatched" | "ambiguous";

const overallDetailTitles: Record<OverallDetailView, string> = {
  scope: "范围广告组",
  processable: "可处理数据",
  unmatched: "未匹配数据",
  ambiguous: "需消歧数据",
};

export function WorkspacePanel() {
  const [overallDetailView, setOverallDetailView] = useState<OverallDetailView | null>(null);
  const {
    campaignGroups,
    workspaceUnits,
    activeCampaignGroupId,
    activeWorkspaceUnitId,
    activeLifecycleGroupId,
    workspaceMode,
    setActiveWorkspaceUnit,
    overallAdDataFileName,
    overallAdDataRows,
    overallAdDataStatus,
    overallAdDataError,
    overallAdDataMatchSummary,
    persistenceStatus,
    persistenceError,
    clearPersistedWorkspace,
    runRulesForActiveWorkspaceUnit,
  } = useWorkspaceStore();
  const activeGroup = campaignGroups.find((group) => group.id === activeCampaignGroupId);
  const activeWorkspaceUnit = workspaceUnits.find((unit) => unit.id === activeWorkspaceUnitId);
  const activeLifecycleGroup =
    workspaceMode === "lifecycle"
      ? lifecycleGroups.find((group) => group.id === activeLifecycleGroupId)
      : lifecycleGroups.find((group) => group.id === activeGroup?.lifecycleGroupId);
  const workspaceUnitGroups = useMemo(
    () => (activeWorkspaceUnit ? campaignGroups.filter((group) => activeWorkspaceUnit.campaignGroupIds.includes(group.id)) : []),
    [activeWorkspaceUnit, campaignGroups],
  );
  const scopedGroups = useMemo(() => {
    if (workspaceMode === "workspace-unit") {
      return workspaceUnitGroups;
    }

    if (workspaceMode === "lifecycle" && activeLifecycleGroupId) {
      return campaignGroups.filter((group) => group.lifecycleGroupId === activeLifecycleGroupId);
    }

    return activeGroup ? [activeGroup] : [];
  }, [activeGroup, activeLifecycleGroupId, campaignGroups, workspaceMode, workspaceUnitGroups]);
  const overallScopeGroups = useMemo(() => {
    if (workspaceMode === "workspace-unit" || workspaceMode === "lifecycle") {
      return scopedGroups;
    }

    if (activeGroup?.lifecycleGroupId) {
      const lifecycleScopeGroups = campaignGroups.filter((group) => group.lifecycleGroupId === activeGroup.lifecycleGroupId);

      return lifecycleScopeGroups.length ? lifecycleScopeGroups : [activeGroup];
    }

    return activeGroup ? [activeGroup] : [];
  }, [activeGroup, campaignGroups, scopedGroups, workspaceMode]);
  const activeRules = activeLifecycleGroup
    ? defaultRules.filter((rule) => rule.lifecycleGroupId === activeLifecycleGroup.id && rule.enabled)
    : [];
  const overallScopeGroupIds = useMemo(() => new Set(overallScopeGroups.map((group) => group.id)), [overallScopeGroups]);
  const detailRows = useMemo(() => {
    if (!overallDetailView || overallDetailView === "scope") {
      return [];
    }

    if (overallDetailView === "processable") {
      return overallAdDataRows.filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId);
    }

    if (overallDetailView === "ambiguous") {
      return overallAdDataRows.filter((row) => row.matchStatus === "ambiguous");
    }

    return overallAdDataRows.filter((row) => row.matchStatus === "unmatched");
  }, [overallAdDataRows, overallDetailView]);
  const overallTotals = overallAdDataRows
    .filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId)
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

  return (
    <div id={workspacePanelAnchorId} className="min-w-0 flex-1 scroll-mt-24 space-y-5">
      <Card>
        <CardContent className="space-y-5 pt-5">
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
                  <span
                    key={rule.id}
                    className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-muted"
                  >
                    {rule.name}
                  </span>
                ))}
                {workspaceMode === "workspace-unit" && activeWorkspaceUnit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setActiveWorkspaceUnit(activeWorkspaceUnit.id);
                      const result = runRulesForActiveWorkspaceUnit();
                      if (result.message) {
                        window.alert(result.message);
                      }
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
                  使用上方主按钮可一次上传多个 CSV 或 Excel；Sellfox Overall 会优先按“广告组 + 投放/搜索词 + 匹配类型”匹配 Bulk 行。
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
              <OverallStatButton onClick={() => setOverallDetailView("scope")}>
                范围广告组：{overallAdDataMatchSummary.scopedCampaignGroups}
              </OverallStatButton>
              <OverallStatButton onClick={() => setOverallDetailView("processable")}>
                可处理：{overallAdDataMatchSummary.matchedRows}
              </OverallStatButton>
              <OverallStatButton onClick={() => setOverallDetailView("unmatched")}>
                未匹配：{overallAdDataMatchSummary.unmatchedRows}
              </OverallStatButton>
              <OverallStatButton onClick={() => setOverallDetailView("ambiguous")}>
                需消歧：{overallAdDataMatchSummary.ambiguousRows}
              </OverallStatButton>
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
      {overallDetailView && (
        <OverallDetailDialog
          title={overallDetailTitles[overallDetailView]}
          view={overallDetailView}
          rows={detailRows}
          scopedGroups={overallScopeGroups}
          scopedGroupIds={overallScopeGroupIds}
          onClose={() => setOverallDetailView(null)}
        />
      )}
    </div>
  );
}

function OverallStatButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-md bg-surface-muted px-3 py-2 text-left transition-colors hover:bg-brand/10 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OverallDetailDialog({
  title,
  view,
  rows,
  scopedGroups,
  scopedGroupIds,
  onClose,
}: {
  title: string;
  view: OverallDetailView;
  rows: OverallAdDataRow[];
  scopedGroups: Array<{ id: string; campaignName: string; adGroupName: string; keywordCount: number }>;
  scopedGroupIds: Set<string>;
  onClose: () => void;
}) {
  const visibleRows = rows.slice(0, 300);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[86vh] w-full max-w-6xl flex-col rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-foreground">{title}</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {view === "scope" ? `${scopedGroups.length} 个广告组` : `${rows.length} 行，最多显示前 300 行`}
            </p>
          </div>
          <button className="rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="thin-scrollbar overflow-auto p-5">
          {view === "scope" ? (
            <div className="grid gap-2 md:grid-cols-2">
              {scopedGroups.map((group) => (
                <div key={group.id} className="rounded-md border border-border bg-surface-muted/40 p-3">
                  <p className="text-sm font-bold text-foreground">{group.adGroupName}</p>
                  <p className="mt-1 text-xs font-semibold text-muted">{group.campaignName}</p>
                  <p className="mt-2 text-xs font-semibold text-muted">关键词：{group.keywordCount.toLocaleString("zh-CN")}</p>
                </div>
              ))}
            </div>
          ) : visibleRows.length ? (
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 bg-white text-muted">
                <tr>
                  {["状态", "关键词 / 投放对象", "匹配类型", "广告组", "曝光", "点击", "花费", "销售", "ACOS", "原因"].map((label) => (
                    <th key={label} className="border-b border-border px-3 py-2 font-bold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="border-b border-border px-3 py-2">
                      <Badge tone={row.matchStatus === "matched" ? "green" : row.matchStatus === "ambiguous" ? "amber" : "red"}>
                        {row.matchStatus === "matched" ? "已匹配" : row.matchStatus === "ambiguous" ? "需消歧" : "未匹配"}
                      </Badge>
                    </td>
                    <td className="border-b border-border px-3 py-2 font-semibold text-foreground">{row.keyword || row.target || "-"}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{row.matchType || "-"}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">
                      {row.adGroupName || (row.campaignGroupId && scopedGroupIds.has(row.campaignGroupId) ? row.campaignGroupId : "-")}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-muted">{row.impressions.toLocaleString("zh-CN")}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{row.clicks.toLocaleString("zh-CN")}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">${row.spend.toFixed(2)}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">${row.sales.toFixed(2)}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">
                      {row.acos === undefined ? "-" : `${row.acos.toFixed(1)}%`}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-muted">{row.matchError || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-sm font-bold text-muted">
              暂无明细
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
