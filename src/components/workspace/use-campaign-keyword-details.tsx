"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { DataTableColumn } from "@/components/ui/data-table";
import type { PerformanceRow } from "@/lib/types";
import { buildPageItems } from "./campaign-grid-home-utils";
import { detailPageSize, type DetailSortKey } from "./use-campaign-grid-home-model";

export function useCampaignKeywordDetails(performanceRows: PerformanceRow[]) {
  const [detailCampaignGroupIds, setDetailCampaignGroupIds] = useState<string[] | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  const deferredQuery = useDeferredValue(detailQuery);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>("keyword");
  const [detailSortDirection, setDetailSortDirection] = useState<"asc" | "desc">("asc");
  const detailRows = useMemo(() => detailCampaignGroupIds ? performanceRows.filter(row => detailCampaignGroupIds.includes(row.campaignGroupId)) : [], [detailCampaignGroupIds, performanceRows]);
  const sortedDetailRows = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();
    const rows = detailRows.filter(row => !query || [row.sheetName ?? "", row.adGroupName, row.keyword, row.matchType, row.target, row.status].join(" ").toLowerCase().includes(query));
    rows.sort((left, right) => {
      const a = left[detailSortKey];
      const b = right[detailSortKey];
      const comparison = typeof a === "number" && typeof b === "number" ? a - b : (a ?? "").toString().toLowerCase().localeCompare((b ?? "").toString().toLowerCase(), "zh-CN");
      return detailSortDirection === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [detailRows, deferredQuery, detailSortKey, detailSortDirection]);
  const detailTotalPages = Math.max(1, Math.ceil(sortedDetailRows.length / detailPageSize));
  const detailPageItems = buildPageItems(detailPage, detailTotalPages);
  const detailRowsPreview = sortedDetailRows.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize);
  useEffect(() => { setDetailPage(1); }, [deferredQuery, detailSortDirection, detailSortKey, detailCampaignGroupIds]);
  useEffect(() => { if (detailPage > detailTotalPages) setDetailPage(detailTotalPages); }, [detailPage, detailTotalPages]);
  function openDetailRows(event: React.MouseEvent | React.KeyboardEvent, ids: string[]) {
    event.stopPropagation();
    setDetailCampaignGroupIds(ids);
    setDetailQuery(""); setDetailSortKey("keyword"); setDetailSortDirection("asc"); setDetailPage(1);
  }
  function closeDetailRows() { setDetailCampaignGroupIds(null); }
  function toggleDetailSort(key: DetailSortKey) {
    if (detailSortKey === key) { setDetailSortDirection(current => current === "asc" ? "desc" : "asc"); return; }
    setDetailSortKey(key);
    setDetailSortDirection(["keyword", "adGroupName", "sheetName", "matchType"].includes(key) ? "asc" : "desc");
  }
  const keywordDetailColumns: DataTableColumn<PerformanceRow>[] = [
    { key: "sheetName", header: "Sheet", sortable: true, sortDirection: detailSortKey === "sheetName" ? detailSortDirection : null, onSort: () => toggleDetailSort("sheetName"), render: row => row.sheetName ?? "Mock Sheet" },
    { key: "adGroupName", header: "Ad Group", sortable: true, sortDirection: detailSortKey === "adGroupName" ? detailSortDirection : null, onSort: () => toggleDetailSort("adGroupName"), render: row => row.adGroupName },
    { key: "keyword", header: "Keyword", sortable: true, sortDirection: detailSortKey === "keyword" ? detailSortDirection : null, onSort: () => toggleDetailSort("keyword"), render: row => row.keyword },
    { key: "matchType", header: "Match Type", sortable: true, sortDirection: detailSortKey === "matchType" ? detailSortDirection : null, onSort: () => toggleDetailSort("matchType"), render: row => row.matchType },
    { key: "currentBid", header: "Bid", numeric: true, sortable: true, sortDirection: detailSortKey === "currentBid" ? detailSortDirection : null, onSort: () => toggleDetailSort("currentBid"), render: row => row.currentBid.toFixed(2) },
    { key: "impressions", header: "Impr.", numeric: true, sortable: true, sortDirection: detailSortKey === "impressions" ? detailSortDirection : null, onSort: () => toggleDetailSort("impressions"), render: row => row.impressions.toLocaleString("zh-CN") },
    { key: "clicks", header: "Clicks", numeric: true, sortable: true, sortDirection: detailSortKey === "clicks" ? detailSortDirection : null, onSort: () => toggleDetailSort("clicks"), render: row => row.clicks.toLocaleString("zh-CN") },
    { key: "orders", header: "Orders", numeric: true, sortable: true, sortDirection: detailSortKey === "orders" ? detailSortDirection : null, onSort: () => toggleDetailSort("orders"), render: row => row.orders.toLocaleString("zh-CN") },
    { key: "sales", header: "Sales", numeric: true, sortable: true, sortDirection: detailSortKey === "sales" ? detailSortDirection : null, onSort: () => toggleDetailSort("sales"), render: row => row.sales.toFixed(2) },
    { key: "spend", header: "Spend", numeric: true, sortable: true, sortDirection: detailSortKey === "spend" ? detailSortDirection : null, onSort: () => toggleDetailSort("spend"), render: row => row.spend.toFixed(2) },
    { key: "status", header: "Status", render: row => row.status === "paused" ? "Paused" : "Enabled" },
  ];
  return { detailCampaignGroupIds, openDetailRows, closeDetailRows, detailRows, sortedDetailRows, detailPage, detailTotalPages, detailQuery, setDetailQuery, detailSortDirection, setDetailSortDirection, detailPageItems, setDetailPage, detailRowsPreview, keywordDetailColumns };
}
