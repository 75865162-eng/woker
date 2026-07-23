"use client";

import { ClipboardList, History, PlayCircle, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { defaultRules, lifecycleGroups } from "@/data/mock-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ExportHistoryRecord, LifecycleGroupId } from "@/lib/types";

const dragMimeType = "application/x-campaign-group-id";
export function LifecycleBoard() {
  const [dragOverGroupId, setDragOverGroupId] = useState<LifecycleGroupId | null>(null);
  const {
    campaignGroups,
    assignLifecycleGroup,
    activeCampaignGroupId,
    activeLifecycleGroupId,
    overallAdDataStatus,
    overallAdDataMatchSummary,
    exportHistoryRecords,
    setActiveCampaignGroup,
    setActiveLifecycleGroup,
    runRulesForActiveLifecycleGroup,
    reuseExportHistory,
  } =
    useWorkspaceStore();

  function assignDraggedGroup(event: React.DragEvent<HTMLElement>, lifecycleGroupId: LifecycleGroupId) {
    event.preventDefault();
    const campaignGroupId = event.dataTransfer.getData(dragMimeType);

    if (campaignGroupId) {
      assignLifecycleGroup(campaignGroupId, lifecycleGroupId);
      setActiveCampaignGroup(campaignGroupId);
    }

    setDragOverGroupId(null);
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {lifecycleGroups.map((group) => {
        const assignedGroups = campaignGroups.filter((item) => item.lifecycleGroupId === group.id);
        const rules = defaultRules.filter((rule) => rule.lifecycleGroupId === group.id && rule.enabled);
        const isDragOver = dragOverGroupId === group.id;
        const isActiveLifecycle = activeLifecycleGroupId === group.id;
        const bidValidationRuleCount = rules.filter((rule) => rule.id.includes("bv-")).length;

        function runLifecycleRules(event: React.MouseEvent<HTMLButtonElement>) {
          event.stopPropagation();

          if (overallAdDataStatus !== "matched" || overallAdDataMatchSummary.matchedRows === 0) {
            window.alert("请先上传并匹配 Overall 所有日期广告数据，再执行产品周期规则与 Bid 安全校验。");
            return;
          }

          setActiveLifecycleGroup(group.id);
          const result = runRulesForActiveLifecycleGroup();
          if (result.message) {
            window.alert(result.message);
          }
        }

        return (
          <section
            key={group.id}
            onClick={() => setActiveLifecycleGroup(isActiveLifecycle ? undefined : group.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverGroupId(group.id);
            }}
            onDragLeave={() => setDragOverGroupId(null)}
            onDrop={(event) => assignDraggedGroup(event, group.id)}
            className={`min-h-[210px] rounded-lg border bg-white p-4 shadow-sm transition-colors ${
              isDragOver || isActiveLifecycle ? "border-brand bg-blue-50" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge tone={group.tone}>{group.name}</Badge>
              <span className="text-xs font-bold text-muted">{assignedGroups.length} 个广告组</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">{group.description}</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <ClipboardList className="h-4 w-4" />
                  {rules.length} 条启用规则
                </span>
                {bidValidationRuleCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-brand">
                    <ShieldCheck className="h-4 w-4" />
                    已包含 {bidValidationRuleCount} 条 BV
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={assignedGroups.length === 0}
                onClick={runLifecycleRules}
                className="h-7 px-2"
              >
                <PlayCircle className="h-4 w-4" />
                运行
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {assignedGroups.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs font-medium leading-5 text-muted">
                  从左侧拖入广告组，或先点击广告组再拖入此分组。
                </div>
              ) : (
                assignedGroups.slice(0, 8).map((campaignGroup) => (
                  <button
                    key={campaignGroup.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(dragMimeType, campaignGroup.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveCampaignGroup(campaignGroup.id);
                      setActiveLifecycleGroup(group.id);
                    }}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      campaignGroup.id === activeCampaignGroupId
                        ? "border-brand bg-blue-50"
                        : "border-border bg-white hover:bg-surface-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-foreground">{campaignGroup.adGroupName}</span>
                      <span className="metric-tabular shrink-0 text-xs font-semibold text-muted">
                        {campaignGroup.keywordCount.toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-medium text-muted">{campaignGroup.campaignName}</p>
                  </button>
                ))
              )}
              {assignedGroups.length > 8 && (
                <p className="text-center text-xs font-semibold text-muted">还有 {assignedGroups.length - 8} 个广告组</p>
              )}
            </div>
          </section>
        );
      })}
      <ExportHistoryCard records={exportHistoryRecords} onReuse={reuseExportHistory} />
    </div>
  );
}

function formatExportTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ExportHistoryCard({
  records,
  onReuse,
}: {
  records: ExportHistoryRecord[];
  onReuse: (recordId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-black text-foreground">导出历史</h2>
        </div>
        <span className="text-xs font-bold text-muted">{records.length} 条记录</span>
      </div>
      <div className="mt-3 space-y-2">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs font-medium leading-5 text-muted">
            成功导出 Bulk 文件后，会在这里保存 Overall 文件、运行词组、广告组和时间。
          </div>
        ) : (
          records.slice(0, 6).map((record) => (
            <article key={record.id} className="rounded-md border border-border bg-surface-muted/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black text-foreground">{record.fileName}</p>
                  <p className="mt-1 text-[11px] font-semibold text-muted">
                    {formatExportTime(record.exportedAt)} · {record.lifecycleGroupName ?? "未分组"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReuse(record.id);
                  }}
                  className="h-7 shrink-0 px-2"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  复用
                </Button>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] font-semibold text-muted">
                <p className="truncate">Overall：{record.overallFileName ?? "-"}</p>
                <p className="truncate">Bulk：{record.bulkFileName ?? "-"}</p>
                <p className="truncate">广告组：{record.campaignGroupNames.slice(0, 4).join("，") || "-"}</p>
                <p className="truncate">词组：{record.keywordNames.slice(0, 6).join("，") || "-"}</p>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
