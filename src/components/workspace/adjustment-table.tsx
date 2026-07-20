"use client";

import { useMemo, useState } from "react";
import { Download, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportBulkDrafts } from "@/lib/bulk/export";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PerformanceRow, OverallAdDataRow } from "@/lib/types";

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

function normalizeMatchValue(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeMatchType(value: string | undefined) {
  const normalized = normalizeMatchValue(value);
  const matchTypeMap: Record<string, string> = {
    exact: "exact",
    精准: "exact",
    phrase: "phrase",
    短语: "phrase",
    broad: "broad",
    广泛: "broad",
    "broad match": "broad",
    "phrase match": "phrase",
    "exact match": "exact",
  };

  return matchTypeMap[normalized] ?? normalized;
}

function buildMatchKey(campaignGroupId: string, keyword: string | undefined, matchType: string | undefined) {
  return `${campaignGroupId}::${normalizeMatchValue(keyword)}::${normalizeMatchType(matchType)}`;
}

function buildKeywordOnlyMatchKey(campaignGroupId: string, keyword: string | undefined) {
  return `${campaignGroupId}::${normalizeMatchValue(keyword)}`;
}

function getPerformanceMatchKeys(row: PerformanceRow) {
  return Array.from(
    new Set([
      buildMatchKey(row.campaignGroupId, row.keyword, row.matchType),
      buildMatchKey(row.campaignGroupId, row.target, row.matchType),
    ]),
  );
}

function getPerformanceKeywordOnlyMatchKeys(row: PerformanceRow) {
  return Array.from(
    new Set([
      buildKeywordOnlyMatchKey(row.campaignGroupId, row.keyword),
      buildKeywordOnlyMatchKey(row.campaignGroupId, row.target),
    ]),
  );
}

function calcCtr(row: Pick<PerformanceRow | OverallAdDataRow, "clicks" | "impressions">) {
  return row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
}

function calcAcos(row: Pick<PerformanceRow | OverallAdDataRow, "spend" | "sales"> & { acos?: number }) {
  return row.acos ?? (row.sales > 0 ? (row.spend / row.sales) * 100 : 0);
}

function calcCpc(row: Pick<PerformanceRow | OverallAdDataRow, "spend" | "clicks"> & { cpc?: number }) {
  return row.cpc ?? (row.clicks > 0 ? row.spend / row.clicks : 0);
}

function MetricCompareCell({
  current,
  recent,
  format = "number",
}: {
  current: number;
  recent?: number;
  format?: "number" | "currency" | "percent";
}) {
  const formatValue = (value: number) => {
    if (format === "currency") {
      return `$${value.toFixed(2)}`;
    }

    if (format === "percent") {
      return `${value.toFixed(1)}%`;
    }

    return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  };

  return (
    <div className="metric-tabular text-right leading-tight">
      <div className="font-semibold text-foreground">{formatValue(current)}</div>
      {recent !== undefined && <div className="mt-1 text-[11px] font-semibold text-brand">{formatValue(recent)}</div>}
    </div>
  );
}

type SortKey =
  | "impressions"
  | "clicks"
  | "ctr"
  | "spend"
  | "cpc"
  | "orders"
  | "acos"
  | "oldValue"
  | "newValue"
  | "deltaPercent";
type SortDirection = "desc" | "asc";
type SortDataSource = "bulk" | "overall";

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey?: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex w-full items-center justify-end gap-1 text-right font-bold text-muted hover:text-foreground"
      title="点击排序：倒序 / 正序 / 复原"
    >
      {label}
      <span className="w-3 text-[10px]">{active ? (direction === "desc" ? "↓" : "↑") : ""}</span>
    </button>
  );
}

export function AdjustmentTable() {
  const [sortKey, setSortKey] = useState<SortKey | undefined>();
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sortDataSource, setSortDataSource] = useState<SortDataSource>("bulk");
  const [dragSelectMode, setDragSelectMode] = useState<"select" | "deselect" | null>(null);
  const [lastSelectedDraftId, setLastSelectedDraftId] = useState<string | undefined>();
  const [boxSelection, setBoxSelection] = useState<{
    active: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    mode: "select" | "deselect";
  } | null>(null);
  const {
    adjustmentDrafts,
    selectedDraftIds,
    performanceRows,
    overallAdDataRows,
    originalWorkbookBuffer,
    uploadedFileName,
    workspaceMode,
    overallAdDataStatus,
    overallAdDataMatchSummary,
    runRulesForActiveGroup,
    runRulesForActiveLifecycleGroup,
    toggleDraft,
    setDraftSelected,
    selectAllDrafts,
    invertDraftSelection,
    clearDraftSelection,
  } = useWorkspaceStore();
  const performanceRowsById = useMemo(() => new Map(performanceRows.map((row) => [row.id, row])), [performanceRows]);
  const overallRowsByMatchKey = useMemo(
    () =>
      new Map(
        overallAdDataRows
          .filter((row) => row.matchStatus === "matched" && row.campaignGroupId)
          .map((row) => [buildMatchKey(row.campaignGroupId ?? "", row.keyword, row.matchType), row]),
      ),
    [overallAdDataRows],
  );
  const overallRowsByKeywordOnlyMatchKey = useMemo(
    () =>
      new Map(
        overallAdDataRows
          .filter((row) => row.matchStatus === "matched" && row.campaignGroupId)
          .map((row) => [buildKeywordOnlyMatchKey(row.campaignGroupId ?? "", row.keyword), row]),
      ),
    [overallAdDataRows],
  );
  const tableRows = useMemo(() => {
    const enrichedRows = adjustmentDrafts.map((draft, index) => {
      const performanceRow = performanceRowsById.get(draft.rowId);
      const overallRow = performanceRow
        ? getPerformanceMatchKeys(performanceRow)
            .map((key) => overallRowsByMatchKey.get(key))
            .find((row): row is OverallAdDataRow => Boolean(row)) ??
          getPerformanceKeywordOnlyMatchKeys(performanceRow)
            .map((key) => overallRowsByKeywordOnlyMatchKey.get(key))
            .find((row): row is OverallAdDataRow => Boolean(row))
        : undefined;
      const metricSource = sortDataSource === "overall" && overallRow ? overallRow : performanceRow;
      const sortValues: Record<SortKey, number> = {
        impressions: metricSource?.impressions ?? 0,
        clicks: metricSource?.clicks ?? 0,
        ctr: metricSource ? calcCtr(metricSource) : 0,
        spend: metricSource?.spend ?? 0,
        cpc: metricSource ? calcCpc(metricSource) : 0,
        orders: metricSource?.orders ?? 0,
        acos: metricSource ? calcAcos(metricSource) : 0,
        oldValue: Number(draft.oldValue ?? draft.currentBid),
        newValue: Number(draft.newValue ?? draft.suggestedBid),
        deltaPercent: draft.deltaPercent,
      };

      return { draft, performanceRow, overallRow, index, sortValues };
    });

    if (!sortKey) {
      return enrichedRows;
    }

    return [...enrichedRows].sort((left, right) => {
      const multiplier = sortDirection === "desc" ? -1 : 1;
      const valueCompare = (left.sortValues[sortKey] - right.sortValues[sortKey]) * multiplier;

      return valueCompare || left.index - right.index;
    });
  }, [
    adjustmentDrafts,
    performanceRowsById,
    overallRowsByKeywordOnlyMatchKey,
    overallRowsByMatchKey,
    sortDataSource,
    sortDirection,
    sortKey,
  ]);

  function handleSort(nextKey: SortKey) {
    if (sortKey !== nextKey) {
      setSortKey(nextKey);
      setSortDirection("desc");
      return;
    }

    if (sortDirection === "desc") {
      setSortDirection("asc");
      return;
    }

    setSortKey(undefined);
    setSortDirection("desc");
  }

  function selectDraftRange(fromDraftId: string, toDraftId: string, selected: boolean) {
    const fromIndex = tableRows.findIndex((row) => row.draft.id === fromDraftId);
    const toIndex = tableRows.findIndex((row) => row.draft.id === toDraftId);

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    for (const row of tableRows.slice(start, end + 1)) {
      setDraftSelected(row.draft.id, selected);
    }
  }

  function startDragSelection(draftId: string, isSelected: boolean, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && lastSelectedDraftId) {
      selectDraftRange(lastSelectedDraftId, draftId, true);
      setLastSelectedDraftId(draftId);
      return;
    }

    setDragSelectMode(event.altKey ? "deselect" : "select");
    setDraftSelected(draftId, event.altKey ? false : !isSelected);
    setLastSelectedDraftId(draftId);
  }

  function continueDragSelection(draftId: string, event: React.MouseEvent<HTMLElement>) {
    if (!dragSelectMode) {
      return;
    }

    if (event.buttons !== 1) {
      setDragSelectMode(null);
      return;
    }

    setDraftSelected(draftId, dragSelectMode === "select");
  }

  function beginBoxSelection(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;

    if (target.closest("button,input,select,textarea,a")) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const container = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX - container.left + event.currentTarget.scrollLeft;
    const startY = event.clientY - container.top + event.currentTarget.scrollTop;

    setBoxSelection({
      active: true,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      mode: event.altKey ? "deselect" : "select",
    });
  }

  function updateBoxSelection(event: React.MouseEvent<HTMLDivElement>) {
    if (!boxSelection?.active) {
      return;
    }

    const container = event.currentTarget.getBoundingClientRect();
    const currentX = event.clientX - container.left + event.currentTarget.scrollLeft;
    const currentY = event.clientY - container.top + event.currentTarget.scrollTop;
    const left = Math.min(boxSelection.startX, currentX);
    const right = Math.max(boxSelection.startX, currentX);
    const top = Math.min(boxSelection.startY, currentY);
    const bottom = Math.max(boxSelection.startY, currentY);
    const rowElements = Array.from(event.currentTarget.querySelectorAll<HTMLTableRowElement>("[data-draft-id]"));

    setBoxSelection({ ...boxSelection, currentX, currentY });

    for (const rowElement of rowElements) {
      const rowRect = rowElement.getBoundingClientRect();
      const rowLeft = rowRect.left - container.left + event.currentTarget.scrollLeft;
      const rowRight = rowLeft + rowRect.width;
      const rowTop = rowRect.top - container.top + event.currentTarget.scrollTop;
      const rowBottom = rowTop + rowRect.height;
      const intersects = rowLeft <= right && rowRight >= left && rowTop <= bottom && rowBottom >= top;

      if (intersects) {
        const draftId = rowElement.dataset.draftId;

        if (draftId) {
          setDraftSelected(draftId, boxSelection.mode === "select");
          setLastSelectedDraftId(draftId);
        }
      }
    }
  }

  function finishPointerSelection() {
    setDragSelectMode(null);
    setBoxSelection(null);
  }

  function handleRunRules() {
    if (overallAdDataStatus !== "matched" || overallAdDataMatchSummary.matchedRows === 0) {
      window.alert("请先上传并匹配 Overall 所有日期广告数据.csv，再执行规则引擎。");
      return;
    }

    if (workspaceMode === "lifecycle") {
      runRulesForActiveLifecycleGroup();
      return;
    }

    runRulesForActiveGroup();
  }

  async function handleExport() {
    if (!originalWorkbookBuffer) {
      window.alert("请先上传原始 Bulk Operations 文件，再导出修改版。");
      return;
    }

    const result = await exportBulkDrafts({
      workbookBuffer: originalWorkbookBuffer,
      drafts: adjustmentDrafts,
      fileName: `已修改-${uploadedFileName ?? "bulk-operations.xlsx"}`,
    });

    if (result.writableCount === 0) {
      window.alert(`没有可写回的草稿。冲突 ${result.conflictCount} 条，阻止 ${result.blockedCount} 条。`);
      return;
    }

    downloadArrayBuffer(result.data, result.fileName);
  }

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-foreground">规则执行与调整结果</h2>
          <p className="text-xs font-medium text-muted">
            {workspaceMode === "lifecycle"
              ? "当前为产品周期组视图，只会展示并处理该组内广告组的优化草稿。"
              : "当前为单广告组视图，只会展示并处理点击打开的广告组数据。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-white text-xs font-bold">
            <button
              type="button"
              onClick={() => setSortDataSource("bulk")}
              className={`px-3 py-2 transition-colors ${
                sortDataSource === "bulk" ? "bg-brand text-white" : "text-muted hover:bg-surface-muted"
              }`}
              title="展示量、点击量、花费、CPC、销量、ACOS 按 Bulk 数据排序"
            >
              Bulk 排序
            </button>
            <button
              type="button"
              onClick={() => setSortDataSource("overall")}
              className={`border-l border-border px-3 py-2 transition-colors ${
                sortDataSource === "overall" ? "bg-brand text-white" : "text-muted hover:bg-surface-muted"
              }`}
              title="展示量、点击量、花费、CPC、销量、ACOS 按 Overall 数据排序"
            >
              Overall 排序
            </button>
          </div>
          <Button variant="secondary" onClick={handleRunRules}>
            <Play className="h-4 w-4" />
            {workspaceMode === "lifecycle" ? "运行产品周期规则" : "运行规则引擎"}
          </Button>
          <Button variant="secondary" onClick={selectAllDrafts}>
            全选
          </Button>
          <Button variant="secondary" onClick={invertDraftSelection}>
            反选
          </Button>
          <Button variant="secondary" onClick={clearDraftSelection}>
            全不选
          </Button>
          <Button onClick={handleExport} disabled={selectedDraftIds.length === 0}>
            <Download className="h-4 w-4" />
            导出 Bulk 文件
          </Button>
        </div>
      </div>
      <div
        className={`thin-scrollbar relative overflow-auto ${boxSelection?.active || dragSelectMode ? "select-none" : ""}`}
        onMouseDown={beginBoxSelection}
        onMouseMove={updateBoxSelection}
        onMouseLeave={finishPointerSelection}
        onMouseUp={finishPointerSelection}
      >
        {boxSelection?.active && (
          <div
            className="pointer-events-none absolute z-20 border border-brand bg-brand/10"
            style={{
              left: Math.min(boxSelection.startX, boxSelection.currentX),
              top: Math.min(boxSelection.startY, boxSelection.currentY),
              width: Math.abs(boxSelection.currentX - boxSelection.startX),
              height: Math.abs(boxSelection.currentY - boxSelection.startY),
            }}
          />
        )}
        <table className="w-full min-w-[1980px] border-collapse text-sm">
          <thead className="sticky top-0 bg-surface-muted text-xs font-bold text-muted">
            <tr>
              <th className="w-12 px-4 py-3 text-left">选</th>
              <th className="px-4 py-3 text-left">Sheet</th>
              <th className="px-4 py-3 text-left">广告组</th>
              <th className="px-4 py-3 text-right">原始行</th>
              <th className="px-4 py-3 text-left">写回列</th>
              <th className="px-4 py-3 text-left">关键词</th>
              <th className="px-4 py-3 text-left">匹配类型</th>
              <th className="px-4 py-3 text-left">投放对象</th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="展示量" sortKey="impressions" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="点击量" sortKey="clicks" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="点击率" sortKey="ctr" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="花费" sortKey="spend" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="CPC" sortKey="cpc" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="销量" sortKey="orders" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="ACOS" sortKey="acos" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="原值" sortKey="oldValue" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="新值" sortKey="newValue" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-right">
                <SortableHeader label="调整幅度" sortKey="deltaPercent" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
              </th>
              <th className="px-4 py-3 text-left">调整原因</th>
              <th className="px-4 py-3 text-left">命中规则</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {adjustmentDrafts.length === 0 ? (
              <tr>
                <td colSpan={20} className="px-4 py-12 text-center text-sm font-medium text-muted">
                  {workspaceMode === "lifecycle"
                    ? "上传并匹配 Overall 所有日期广告数据后，点击“运行产品周期规则”生成草稿；Launch/Mature 会追加 BV-01/BV-02 Bid 安全校验。"
                    : "上传并匹配 Overall 所有日期广告数据后，点击上方广告组卡片打开组内数据，再运行规则引擎生成草稿。"}
                </td>
              </tr>
            ) : (
              tableRows.map(({ draft, performanceRow, overallRow }) => {
                return (
                <tr
                  key={draft.id}
                  data-draft-id={draft.id}
                  onMouseDown={(event) => startDragSelection(draft.id, selectedDraftIds.includes(draft.id), event)}
                  onMouseEnter={(event) => continueDragSelection(draft.id, event)}
                  className="cursor-default hover:bg-surface-muted/70"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedDraftIds.includes(draft.id)}
                      onMouseDown={(event) => startDragSelection(draft.id, selectedDraftIds.includes(draft.id), event)}
                      onChange={() => toggleDraft(draft.id)}
                      className="h-4 w-4 accent-brand"
                    />
                  </td>
                  <td
                    className="max-w-[180px] truncate px-4 py-3 font-semibold text-foreground"
                  >
                    {draft.sheetName ?? "Mock Sheet"}
                  </td>
                  <td
                    className="max-w-[220px] truncate px-4 py-3 text-muted"
                  >
                    {draft.campaignGroupId}
                  </td>
                  <td
                    className="metric-tabular px-4 py-3 text-right"
                  >
                    {draft.sourceRowNumber ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    {draft.headerName ?? "竞价"}
                  </td>
                  <td className="px-4 py-3">
                    {draft.keyword}
                  </td>
                  <td className="px-4 py-3">
                    {performanceRow?.matchType ?? "-"}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-muted">
                    {draft.target}
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell current={performanceRow?.impressions ?? 0} recent={overallRow?.impressions} />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell current={performanceRow?.clicks ?? 0} recent={overallRow?.clicks} />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell
                      current={performanceRow ? calcCtr(performanceRow) : 0}
                      recent={overallRow ? calcCtr(overallRow) : undefined}
                      format="percent"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell current={performanceRow?.spend ?? 0} recent={overallRow?.spend} format="currency" />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell
                      current={performanceRow ? calcCpc(performanceRow) : 0}
                      recent={overallRow ? calcCpc(overallRow) : undefined}
                      format="currency"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell current={performanceRow?.orders ?? 0} recent={overallRow?.orders} />
                  </td>
                  <td className="px-4 py-3">
                    <MetricCompareCell
                      current={performanceRow ? calcAcos(performanceRow) : 0}
                      recent={overallRow ? calcAcos(overallRow) : undefined}
                      format="percent"
                    />
                  </td>
                  <td className="metric-tabular px-4 py-3 text-right">
                    ${Number(draft.oldValue ?? draft.currentBid).toFixed(2)}
                  </td>
                  <td className="metric-tabular px-4 py-3 text-right font-bold text-brand">
                    ${Number(draft.newValue ?? draft.suggestedBid).toFixed(2)}
                  </td>
                  <td className="metric-tabular px-4 py-3 text-right font-bold text-danger">
                    {draft.deltaPercent}%
                  </td>
                  <td className="px-4 py-3">{draft.reason}</td>
                  <td className="px-4 py-3 text-muted">{draft.matchedRule}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs font-semibold text-muted">
        <span>已选择 {selectedDraftIds.length} 条可写回记录</span>
        <span className="inline-flex items-center gap-2">
          <Download className="h-4 w-4" />
          导出会保留原文件全部 Sheet，仅写回已勾选草稿
        </span>
      </div>
    </div>
  );
}
