"use client";

import { Download, Layers3, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { OperationProgress } from "@/components/ui/operation-progress";
import { exportSelectedDrafts } from "@/lib/excel/bulk-export";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

function downloadArrayBuffer(data: ArrayBuffer, fileName: string) {
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function PendingDraftQueue() {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ label: string; progress: number } | null>(null);
  const {
    pendingAdjustmentDrafts,
    campaignGroups,
    originalWorkbookBuffer,
    uploadedFileName,
    removePendingDraftsForCampaignGroup,
    clearPendingAdjustmentDrafts,
    recordExportHistory,
  } = useWorkspaceStore();
  const pendingGroups = useMemo(() => {
    const counts = pendingAdjustmentDrafts.reduce<Map<string, number>>((map, draft) => {
      map.set(draft.campaignGroupId, (map.get(draft.campaignGroupId) ?? 0) + 1);
      return map;
    }, new Map());

    return Array.from(counts.entries()).map(([campaignGroupId, rowCount]) => {
      const campaignGroup = campaignGroups.find((group) => group.id === campaignGroupId);
      return {
        campaignGroupId,
        campaignName: campaignGroup?.campaignName ?? "-",
        adGroupName: campaignGroup?.adGroupName ?? campaignGroupId,
        rowCount,
      };
    });
  }, [campaignGroups, pendingAdjustmentDrafts]);

  async function exportAllPendingDrafts() {
    if (!originalWorkbookBuffer || pendingAdjustmentDrafts.length === 0) {
      return;
    }

    setExporting(true);
    setExportProgress({ label: "准备合并导出", progress: 20 });

    try {
      await waitForPaint();
      const drafts = pendingAdjustmentDrafts.map((draft) => ({ ...draft, selected: true }));
      setExportProgress({ label: "写回全部待处理草稿", progress: 55 });
      await waitForPaint();
      const result = await exportSelectedDrafts({
        workbookBuffer: originalWorkbookBuffer,
        drafts,
        fileName: `已修改-全部待处理-${uploadedFileName ?? "bulk-operations.xlsx"}`,
      });

      if (result.writableCount === 0) {
        setExportProgress(null);
        window.alert(`没有可写回的待处理草稿。冲突 ${result.conflictCount} 条，阻止 ${result.blockedCount} 条。`);
        return;
      }

      setExportProgress({ label: "下载导出文件", progress: 90 });
      downloadArrayBuffer(result.data, result.fileName);
      recordExportHistory(result.fileName, drafts);
      setExportProgress({ label: "导出完成", progress: 100 });
      window.setTimeout(() => setExportProgress(null), 1200);
    } catch (error) {
      setExportProgress(null);
      window.alert(error instanceof Error ? error.message : "合并导出 Bulk 文件失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-brand" />
            <h2 className="text-base font-black text-foreground">待处理修改</h2>
          </div>
          <p className="mt-1 text-xs font-semibold text-muted">
            已暂存 {pendingGroups.length} 个广告组、{pendingAdjustmentDrafts.length} 行修改，可继续运行其他广告组后统一导出。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {exportProgress ? <OperationProgress label={exportProgress.label} progress={exportProgress.progress} /> : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={clearPendingAdjustmentDrafts}
            disabled={pendingAdjustmentDrafts.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            清空
          </Button>
          <Button onClick={() => void exportAllPendingDrafts()} disabled={!originalWorkbookBuffer || pendingAdjustmentDrafts.length === 0 || exporting}>
            <Download className="h-4 w-4" />
            {exporting ? "导出中..." : "合并导出 Bulk"}
          </Button>
        </div>
      </header>
      <div className="p-5">
        {pendingGroups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm font-semibold text-muted">
            运行广告组规则后，修改结果会自动暂存在这里。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-surface-muted text-xs font-black text-muted">
                <tr>
                  <th className="border-b border-r border-border px-4 py-3 text-left">广告活动名称</th>
                  <th className="border-b border-r border-border px-4 py-3 text-left">广告组名称</th>
                  <th className="w-28 border-b border-r border-border px-4 py-3 text-right">修改行数</th>
                  <th className="w-20 border-b border-border px-4 py-3 text-center">移除</th>
                </tr>
              </thead>
              <tbody>
                {pendingGroups.map((group) => (
                  <tr key={group.campaignGroupId}>
                    <td className="border-b border-r border-border px-4 py-3 font-semibold text-muted">{group.campaignName}</td>
                    <td className="border-b border-r border-border px-4 py-3 font-bold text-foreground">{group.adGroupName}</td>
                    <td className="border-b border-r border-border px-4 py-3 text-right font-black tabular-nums text-brand">{group.rowCount}</td>
                    <td className="border-b border-border px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => removePendingDraftsForCampaignGroup(group.campaignGroupId)}
                        className="mx-auto grid h-8 w-8 place-items-center rounded border border-border text-muted hover:border-danger hover:text-danger"
                        title="移出待处理"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
