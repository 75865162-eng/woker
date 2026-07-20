"use client";

import { ArrowUpRight, Download, RotateCcw, Search, SlidersHorizontal, UploadCloud } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBulkUpload } from "@/lib/hooks/use-bulk-upload";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { workspacePanelAnchorId } from "@/lib/workspace-events";
import type { PerformanceRow } from "@/lib/types";

const pageSize = 16;
const detailPageSize = 25;
const dragMimeType = "application/x-campaign-group-id";

type PageItem = number | "...";
type DetailSortKey =
  | "keyword"
  | "adGroupName"
  | "sheetName"
  | "matchType"
  | "currentBid"
  | "impressions"
  | "clicks"
  | "orders"
  | "sales"
  | "spend";

function buildPageItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1) as PageItem[];
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

function escapeCsvCell(value: string | number | undefined) {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName: string, rows: Array<Array<string | number | undefined>>) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function CampaignGridHome() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detailCampaignGroupIds, setDetailCampaignGroupIds] = useState<string[] | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  const deferredDetailQuery = useDeferredValue(detailQuery);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>("keyword");
  const [detailSortDirection, setDetailSortDirection] = useState<"asc" | "desc">("asc");
  const groupingInputRef = useRef<HTMLInputElement>(null);
  const { fileInputRef, handleFileSelected } = useBulkUpload();
  const {
    campaignGroups,
    workspaceUnits,
    performanceRows,
    activeCampaignGroupId,
    activeLifecycleGroupId,
    openCampaignGroup,
    mergeCampaignGroupsIntoWorkspaceUnit,
    removeCampaignGroupFromWorkspaceUnit,
    setActiveWorkspaceUnit,
    importGroupingStatusCsv,
  } = useWorkspaceStore();

  const groupedCampaignIds = useMemo(
    () => new Set(workspaceUnits.flatMap((unit) => unit.campaignGroupIds)),
    [workspaceUnits],
  );

  const filteredCampaigns = useMemo(
    () =>
      campaignGroups.filter((campaign) => {
        const grouped = groupedCampaignIds.has(campaign.id);
        const unitContainsCampaign = workspaceUnits.some((unit) => unit.campaignGroupIds[0] === campaign.id);
        const matchesQuery = `${campaign.sheetName ?? ""} ${campaign.campaignName} ${campaign.adGroupName}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesLifecycle = activeLifecycleGroupId ? campaign.lifecycleGroupId === activeLifecycleGroupId : true;

        return matchesQuery && matchesLifecycle && (!grouped || unitContainsCampaign);
      }),
    [activeLifecycleGroupId, campaignGroups, groupedCampaignIds, query, workspaceUnits],
  );

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / pageSize));
  const pagedCampaigns = filteredCampaigns.slice((page - 1) * pageSize, page * pageSize);
  const pageItems = buildPageItems(page, totalPages);

  const detailRows = useMemo(
    () =>
      detailCampaignGroupIds
        ? performanceRows.filter((row) => detailCampaignGroupIds.includes(row.campaignGroupId))
        : [],
    [detailCampaignGroupIds, performanceRows],
  );

  const filteredDetailRows = useMemo(() => {
    const normalizedQuery = deferredDetailQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return detailRows;
    }

    return detailRows.filter((row) =>
      [row.sheetName ?? "", row.adGroupName, row.keyword, row.matchType, row.target, row.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [deferredDetailQuery, detailRows]);

  const sortedDetailRows = useMemo(() => {
    const rows = [...filteredDetailRows];

    rows.sort((left, right) => {
      const leftRaw = left[detailSortKey];
      const rightRaw = right[detailSortKey];
      const comparison =
        typeof leftRaw === "number" && typeof rightRaw === "number"
          ? leftRaw - rightRaw
          : (leftRaw ?? "")
              .toString()
              .toLowerCase()
              .localeCompare((rightRaw ?? "").toString().toLowerCase(), "zh-CN");

      return detailSortDirection === "asc" ? comparison : -comparison;
    });

    return rows;
  }, [detailSortDirection, detailSortKey, filteredDetailRows]);

  const detailTotalPages = Math.max(1, Math.ceil(sortedDetailRows.length / detailPageSize));
  const detailPageItems = buildPageItems(detailPage, detailTotalPages);
  const detailRowsPreview = sortedDetailRows.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize);

  useEffect(() => {
    setPage(1);
  }, [query, activeLifecycleGroupId]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setDetailPage(1);
  }, [deferredDetailQuery, detailSortDirection, detailSortKey, detailCampaignGroupIds]);

  useEffect(() => {
    if (detailPage > detailTotalPages) {
      setDetailPage(detailTotalPages);
    }
  }, [detailPage, detailTotalPages]);

  function openWorkspaceDetail(campaignGroupId: string, workspaceUnitId?: string) {
    if (workspaceUnitId) {
      setActiveWorkspaceUnit(workspaceUnitId);
    } else {
      openCampaignGroup(campaignGroupId);
    }

    requestAnimationFrame(() => {
      document.getElementById(workspacePanelAnchorId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>, campaignGroupId: string, workspaceUnitId?: string) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openWorkspaceDetail(campaignGroupId, workspaceUnitId);
  }

  function openDetailRows(event: React.MouseEvent | React.KeyboardEvent, campaignGroupIds: string[]) {
    event.stopPropagation();
    setDetailCampaignGroupIds(campaignGroupIds);
    setDetailQuery("");
    setDetailSortKey("keyword");
    setDetailSortDirection("asc");
    setDetailPage(1);
  }

  function closeDetailRows() {
    setDetailCampaignGroupIds(null);
  }

  function toggleDetailSort(sortKey: DetailSortKey) {
    if (detailSortKey === sortKey) {
      setDetailSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setDetailSortKey(sortKey);
    setDetailSortDirection(
      sortKey === "keyword" || sortKey === "adGroupName" || sortKey === "sheetName" || sortKey === "matchType"
        ? "asc"
        : "desc",
    );
  }

  function handleDownloadGroupingStatus() {
    const workspaceUnitByCampaignGroupId = new Map<string, string>();

    workspaceUnits.forEach((unit) => {
      unit.campaignGroupIds.forEach((campaignGroupId) => {
        workspaceUnitByCampaignGroupId.set(campaignGroupId, unit.name);
      });
    });

    downloadCsv("campaign-grouping-status.csv", [
      ["campaignGroupId", "sheetName", "campaignName", "adGroupName", "lifecycleGroup", "workspaceUnit"],
      ...campaignGroups.map((group) => [
        group.id,
        group.sheetName ?? "",
        group.campaignName,
        group.adGroupName,
        group.lifecycleGroupId ?? "",
        workspaceUnitByCampaignGroupId.get(group.id) ?? "",
      ]),
    ]);
  }

  async function handleGroupingStatusSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    const text = await file.text();
    const result = importGroupingStatusCsv(file.name, text);

    window.alert(`已导入 ${result.importedRows} 个广告组，生成 ${result.workspaceUnitCount} 个工作区分组。`);

    if (groupingInputRef.current) {
      groupingInputRef.current.value = "";
    }
  }

  function renderMetricCell(value: string | number, align: "left" | "right" = "left") {
    return <td className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>{value}</td>;
  }

  function renderSortableHeader(label: string, sortKey: DetailSortKey, align: "left" | "right" = "left") {
    const active = detailSortKey === sortKey;
    const arrow = active ? (detailSortDirection === "asc" ? "↑" : "↓") : "";

    return (
      <th className={`px-3 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
        <button
          type="button"
          onClick={() => toggleDetailSort(sortKey)}
          className={`inline-flex items-center gap-1 transition-colors ${active ? "text-brand" : "hover:text-foreground"}`}
          title={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span className="min-w-3 text-[11px]">{arrow}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="hidden"
          aria-hidden
          onChange={(event) => void handleFileSelected(event.target.files?.[0])}
        />
        <input
          ref={groupingInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-hidden
          onChange={(event) => void handleGroupingStatusSelected(event.target.files?.[0])}
        />
        <Button onClick={() => fileInputRef.current?.click()}>
          <UploadCloud className="h-4 w-4" />
          Upload Bulk
        </Button>
        <Button variant="secondary" onClick={() => groupingInputRef.current?.click()}>
          <UploadCloud className="h-4 w-4" />
          上传分组
        </Button>
        <Button variant="secondary" onClick={handleDownloadGroupingStatus}>
          <Download className="h-4 w-4" />
          下载分组状态
        </Button>
        <div className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-border px-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaign, ad group, or sheet"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
          <SlidersHorizontal className="h-4 w-4 text-brand" />
          Product Cycle Filter {activeLifecycleGroupId ? `· ${activeLifecycleGroupId}` : "· All"}
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
          Sort · Last Updated
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
          View · Campaign Grid
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-muted">
          {filteredCampaigns.length} campaigns · Page {page} / {totalPages}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pageItems.map((item, index) =>
            item === "..." ? (
              <span key={`ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (typeof item === "number") {
                    setPage(item);
                  }
                }}
                className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${
                  page === item ? "bg-brand text-white" : "border border-border bg-white text-muted hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pagedCampaigns.map((campaign) => {
          const active = campaign.id === activeCampaignGroupId;
          const workspaceUnit = workspaceUnits.find((unit) => unit.campaignGroupIds[0] === campaign.id);
          const tileCampaigns = workspaceUnit
            ? campaignGroups.filter((group) => workspaceUnit.campaignGroupIds.includes(group.id)).slice(0, 4)
            : [campaign];
          const keywordCount = tileCampaigns.reduce((sum, group) => sum + group.keywordCount, 0);
          const splitLayout = tileCampaigns.length >= 4 ? "grid-cols-2" : tileCampaigns.length >= 2 ? "grid-cols-2" : "grid-cols-1";

          return (
            <div
              key={campaign.id}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(dragMimeType, campaign.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceCampaignGroupId = event.dataTransfer.getData(dragMimeType);

                if (sourceCampaignGroupId) {
                  mergeCampaignGroupsIntoWorkspaceUnit(sourceCampaignGroupId, campaign.id);
                }
              }}
              onClick={() => {
                if (workspaceUnit) {
                  openWorkspaceDetail(campaign.id, workspaceUnit.id);
                } else {
                  openWorkspaceDetail(campaign.id);
                }
              }}
              onKeyDown={(event) => handleCardKeyDown(event, campaign.id, workspaceUnit?.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                active ? "border-brand bg-white shadow-[0_12px_30px_rgba(23,107,135,0.12)]" : "border-border bg-white hover:-translate-y-0.5"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-muted">
                    {campaign.sheetName ?? "Bulk"}
                  </p>
                  <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-6 text-foreground">
                    {workspaceUnit ? workspaceUnit.name : campaign.adGroupName}
                  </h3>
                  <p className="mt-1 truncate text-xs text-muted">{campaign.campaignName}</p>
                </div>
                <ArrowUpRight className={`h-5 w-5 shrink-0 ${active ? "text-brand" : "text-muted"}`} />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Badge tone={campaign.lifecycleGroupId === "mature" ? "green" : campaign.lifecycleGroupId === "decline" ? "amber" : campaign.lifecycleGroupId === "clearance" ? "red" : "blue"}>
                  {campaign.lifecycleGroupId ?? "unassigned"}
                </Badge>
                <span className="text-xs font-semibold text-muted">Updated {campaign.lastUpdated}</span>
              </div>

              <div className={`mt-3 grid gap-2 rounded-xl bg-surface-muted p-2.5 ${splitLayout}`}>
                {tileCampaigns.map((tileCampaign) => (
                  <div
                    key={tileCampaign.id}
                    draggable
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.setData(dragMimeType, tileCampaign.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    className="rounded-lg bg-white/80 p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-bold text-muted">{tileCampaign.adGroupName}</p>
                      {workspaceUnit ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeCampaignGroupFromWorkspaceUnit(tileCampaign.id);
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-[10px] font-semibold text-muted transition-colors hover:border-brand hover:text-brand"
                          title={`Move ${tileCampaign.adGroupName} out of this workspace`}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Undo
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-[15px] font-black text-foreground">{tileCampaign.keywordCount.toLocaleString("zh-CN")}</p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={(event) => openDetailRows(event, tileCampaigns.map((group) => group.id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    openDetailRows(event, tileCampaigns.map((group) => group.id));
                  }
                }}
                className="mt-2.5 grid w-full grid-cols-2 gap-2 rounded-xl bg-surface-muted p-2.5 text-left transition-colors hover:bg-blue-50"
                title="View parsed keyword details"
              >
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Keywords</p>
                  <p className="mt-1 text-[15px] font-black text-foreground">{keywordCount.toLocaleString("zh-CN")}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Workspace</p>
                  <p className="mt-1 text-[15px] font-bold text-foreground">{workspaceUnit ? `${tileCampaigns.length} groups` : "Open"}</p>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {detailCampaignGroupIds ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4 py-8"
          onClick={closeDetailRows}
        >
          <div
            className="max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Parsed Keyword Details</h3>
                <p className="mt-1 text-sm text-muted">
                  Total {detailRows.length.toLocaleString("zh-CN")} rows, filtered to {sortedDetailRows.length.toLocaleString("zh-CN")} rows, page {detailPage} / {detailTotalPages}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex h-10 min-w-[240px] items-center gap-2 rounded-lg border border-border px-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    value={detailQuery}
                    onChange={(event) => setDetailQuery(event.target.value)}
                    placeholder="Search keyword, ad group, sheet, or match type"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <select
                  value={detailSortDirection}
                  onChange={(event) => setDetailSortDirection(event.target.value as "asc" | "desc")}
                  className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground outline-none"
                >
                  <option value="asc">A-Z</option>
                  <option value="desc">Z-A</option>
                </select>
                <Button variant="secondary" onClick={closeDetailRows}>
                  Close
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {detailPageItems.map((item, index) =>
                    item === "..." ? (
                      <span key={`detail-header-ellipsis-${index}`} className="px-1 text-sm font-semibold text-muted">
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          if (typeof item === "number") {
                            setDetailPage(item);
                          }
                        }}
                        className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${
                          detailPage === item ? "bg-brand text-white" : "border border-border bg-white text-muted hover:text-foreground"
                        }`}
                      >
                        {item}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="thin-scrollbar max-h-[calc(85vh-88px)] overflow-auto">
              {detailRows.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm font-medium text-muted">
                  No parsed keyword rows are available for this card yet.
                </div>
              ) : (
                <>
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs font-bold text-muted">
                      <tr>
                        {renderSortableHeader("Sheet", "sheetName")}
                        {renderSortableHeader("Ad Group", "adGroupName")}
                        {renderSortableHeader("Keyword", "keyword")}
                        {renderSortableHeader("Match Type", "matchType")}
                        {renderSortableHeader("Bid", "currentBid", "right")}
                        {renderSortableHeader("Impr.", "impressions", "right")}
                        {renderSortableHeader("Clicks", "clicks", "right")}
                        {renderSortableHeader("Orders", "orders", "right")}
                        {renderSortableHeader("Sales", "sales", "right")}
                        {renderSortableHeader("Spend", "spend", "right")}
                        <th className="px-3 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detailRowsPreview.map((row: PerformanceRow) => (
                        <tr key={row.id} className="bg-white">
                          {renderMetricCell(row.sheetName ?? "Mock Sheet")}
                          {renderMetricCell(row.adGroupName)}
                          {renderMetricCell(row.keyword)}
                          {renderMetricCell(row.matchType)}
                          {renderMetricCell(row.currentBid.toFixed(2), "right")}
                          {renderMetricCell(row.impressions.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.clicks.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.orders.toLocaleString("zh-CN"), "right")}
                          {renderMetricCell(row.sales.toFixed(2), "right")}
                          {renderMetricCell(row.spend.toFixed(2), "right")}
                          {renderMetricCell(row.status === "paused" ? "Paused" : "Enabled")}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
                    <p className="text-sm font-medium text-muted">
                      Showing {detailRowsPreview.length.toLocaleString("zh-CN")} rows on this page
                    </p>
                    <p className="text-sm font-medium text-muted">Pagination is pinned to the top-right of the modal</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pagedCampaigns.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-white px-5 py-10 text-center text-sm font-medium text-muted">
          No campaign groups match the current filters.
        </div>
      )}
    </section>
  );
}
