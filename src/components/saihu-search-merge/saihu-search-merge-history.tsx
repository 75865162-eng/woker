"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Database, Download, RefreshCcw, Search, Trash2 } from "lucide-react";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSaihuSearchMergeWorkbook, createSaihuSearchMergeFileName } from "@/lib/saihu-search-merge/merge";
import { clearSaihuHistoryRecords, listSaihuHistoryRecords } from "@/lib/saihu-search-merge/history";
import type { SaihuHistoryAction, SaihuHistoryRecord, SaihuMergedRow } from "@/lib/saihu-search-merge/types";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getActionLabel(action: SaihuHistoryAction) {
  return action === "upload" ? "上传合并" : "导出文件";
}

function getScopeLabel(record: SaihuHistoryRecord) {
  return [record.workspaceId || "default", record.marketplace, record.accountId].filter(Boolean).join(" / ");
}

function getHistoryDownloadName(record: SaihuHistoryRecord) {
  return record.outputFileName || createSaihuSearchMergeFileName(record.sourceFileName);
}

async function getHistoryDownloadBlob(record: SaihuHistoryRecord) {
  if (record.outputBlob) {
    return record.outputBlob;
  }

  return buildSaihuSearchMergeWorkbook({
    summary: record.summary,
    rows: record.rows,
  });
}

function HistoryRowsPreview({ rows }: { rows: SaihuMergedRow[] }) {
  const previewRows = rows.slice(0, 20);
  const previewColumns: DataTableColumn<SaihuMergedRow>[] = [
    { key: "searchTerm", header: "搜索词", className: "max-w-[220px] truncate font-medium text-foreground", cellAttributes: (row) => ({ title: row.searchTerm }), render: (row) => row.searchTerm },
    { key: "translation", header: "翻译", className: "max-w-[220px] truncate text-muted", cellAttributes: (row) => ({ title: row.translation }), render: (row) => row.translation || "--" },
    { key: "orderCount", header: "订单", numeric: true, render: (row) => formatNumber(row.orderCount) },
    { key: "impressions", header: "曝光", numeric: true, render: (row) => formatNumber(row.impressions) },
    { key: "clicks", header: "点击", numeric: true, render: (row) => formatNumber(row.clicks) },
    { key: "spend", header: "花费", numeric: true, render: (row) => formatNumber(row.spend, 2) },
    { key: "sales", header: "销售额", numeric: true, render: (row) => formatNumber(row.sales, 2) },
    { key: "sourceRows", header: "来源行", numeric: true, render: (row) => formatNumber(row.sourceRows) },
  ];

  return (
    <StandardDataTable
      ariaLabel="历史记录合并结果预览"
      rows={previewRows}
      getRowKey={(row) => row.searchTerm}
      columns={previewColumns}
      empty="暂无合并结果。"
      maxHeight="380px"
    />
  );
}

export function SaihuSearchMergeHistory() {
  const [records, setRecords] = useState<SaihuHistoryRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const replayRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await listSaihuHistoryRecords({
        page,
        pageSize,
        search: appliedSearch,
      });
      setRecords(response.records);
      setPagination(response.pagination);
      setSelectedRecordId((current) => (response.records.some((record) => record.id === current) ? current : response.records[0]?.id ?? null));
    } finally {
      setBusy(false);
    }
  }, [appliedSearch, page, pageSize]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearHistory = async () => {
    setBusy(true);
    try {
      await clearSaihuHistoryRecords();
      setRecords([]);
      setPagination({ page: 1, pageSize, total: 0, pageCount: 1 });
      setSelectedRecordId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (record: SaihuHistoryRecord) => {
    downloadBlob(await getHistoryDownloadBlob(record), getHistoryDownloadName(record));
  };

  const handleViewRecord = (recordId: string) => {
    setSelectedRecordId(recordId);
    window.requestAnimationFrame(() => {
      replayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null,
    [records, selectedRecordId],
  );

  const historyColumns: DataTableColumn<SaihuHistoryRecord>[] = [
    { key: "createdAt", header: "时间", width: 180, className: "whitespace-nowrap metric-tabular text-muted", render: (record) => formatDateTime(record.createdAt) },
    { key: "action", header: "动作", width: 100, align: "center", render: (record) => <Badge tone={record.action === "export" ? "green" : "blue"} className="min-w-[84px] justify-center whitespace-nowrap px-2">{getActionLabel(record.action)}</Badge> },
    { key: "sourceFileName", header: "源文件", width: 100, className: "truncate font-medium text-foreground", cellAttributes: (record) => ({ title: record.sourceFileName }), render: (record) => record.sourceFileName },
    { key: "outputFileName", header: "导出文件", width: 100, className: "truncate text-muted", cellAttributes: (record) => ({ title: record.outputFileName }), render: (record) => record.outputFileName || "--" },
    { key: "sourceRows", header: "原始行", width: 85, numeric: true, render: (record) => formatNumber(record.summary.sourceRows) },
    { key: "mergedRows", header: "合并词", width: 85, numeric: true, render: (record) => formatNumber(record.summary.mergedRows) },
    { key: "duplicateTermCount", header: "重复词", width: 85, numeric: true, render: (record) => formatNumber(record.summary.duplicateTermCount) },
    { key: "totalOrders", header: "订单", width: 85, numeric: true, render: (record) => formatNumber(record.summary.totalOrders) },
    { key: "totalImpressions", header: "曝光", width: 85, numeric: true, render: (record) => formatNumber(record.summary.totalImpressions) },
    { key: "totalClicks", header: "点击", width: 85, numeric: true, render: (record) => formatNumber(record.summary.totalClicks) },
    { key: "totalSpend", header: "花费", width: 85, numeric: true, render: (record) => formatNumber(record.summary.totalSpend, 2) },
    { key: "totalSales", header: "销售额", width: 85, numeric: true, render: (record) => formatNumber(record.summary.totalSales, 2) },
    { key: "files", header: "文件", width: 200, align: "right", render: (record) => <div className="flex justify-end gap-2 whitespace-nowrap"><Button size="sm" variant="secondary" className="min-w-[72px] whitespace-nowrap px-2" onClick={() => handleViewRecord(record.id)}>查看</Button><Button size="sm" variant="secondary" className="min-w-[84px] whitespace-nowrap px-2" onClick={() => void handleDownload(record)}><Download className="h-4 w-4" />下载</Button></div> },
  ];

  return (
    <ListPageTemplate
      header={<Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>后台历史记录</CardTitle>
                <p className="mt-1 text-sm text-muted">这里读取数据库里的赛狐搜索词合并历史，可按文件名搜索、按页查看和回放单条记录。</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => void refresh()} disabled={busy}>
                  <RefreshCcw className="h-4 w-4" />
                  刷新
                </Button>
                <Button variant="ghost" onClick={() => void clearHistory()} disabled={busy || !records.length}>
                  <Trash2 className="h-4 w-4" />
                  清空
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>}
        stats={<Card><CardContent>
            <div className="grid gap-[var(--gap-section)] md:grid-cols-4 xl:grid-cols-5">
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">总记录</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(pagination.total)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">当前页上传合并</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(records.filter((item) => item.action === "upload").length)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">当前页导出文件</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(records.filter((item) => item.action === "export").length)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">当前页最新</p>
                <p className="mt-2 truncate text-sm font-semibold text-foreground">{records[0] ? formatDateTime(records[0].createdAt) : "--"}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">当前页</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{pagination.page}/{pagination.pageCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>}

        table={<div className="flex flex-col gap-[var(--gap-section)]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-brand" />
                <CardTitle>记录明细</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
                  <Search className="h-4 w-4" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setPage(1);
                        setAppliedSearch(search.trim());
                      }
                    }}
                    placeholder="搜索源文件或导出文件"
                    className="w-[220px] bg-transparent text-sm text-foreground outline-none"
                  />
                </label>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPage(1);
                    setPageSize(Number(event.target.value));
                  }}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value={10}>10 / 页</option>
                  <option value={25}>25 / 页</option>
                  <option value={50}>50 / 页</option>
                  <option value={100}>100 / 页</option>
                </select>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPage(1);
                    setAppliedSearch(search.trim());
                  }}
                  disabled={busy}
                >
                  <Search className="h-4 w-4" />
                  查询
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {records.length ? (
              <div className="space-y-4">
                <StandardDataTable
                  ariaLabel="赛狐搜索词合并历史记录"
                  rows={records}
                  getRowKey={(record) => record.id}
                  columns={historyColumns}
                  rowClassName={(record) => record.id === selectedRecordId ? "bg-brand/5" : undefined}
                  maxHeight="620px"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    第 {pagination.page} / {pagination.pageCount} 页，共 {formatNumber(pagination.total)} 条记录。
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={busy || pagination.page <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                      上一页
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setPage((current) => Math.min(current + 1, pagination.pageCount))}
                      disabled={busy || pagination.page >= pagination.pageCount}
                    >
                      下一页
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-surface-muted/50 px-4 py-10 text-center text-sm text-muted">
                暂无历史记录。后续在赛狐客搜词合并数据页面上传或导出后，会自动保存到这里。
              </div>
            )}
          </CardContent>
        </Card>

        {selectedRecord ? (
          <div ref={replayRef}>
            <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>记录回放</CardTitle>
                  <p className="mt-1 text-sm text-muted">查看这一条数据库快照的摘要和前 20 行合并结果。</p>
                </div>
                <Badge tone={selectedRecord.action === "export" ? "green" : "blue"}>{getActionLabel(selectedRecord.action)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">源文件</p>
                  <p className="mt-2 truncate text-sm font-semibold text-foreground" title={selectedRecord.sourceFileName}>
                    {selectedRecord.sourceFileName}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">工作区</p>
                  <p className="mt-2 truncate text-sm font-semibold text-foreground" title={getScopeLabel(selectedRecord)}>
                    {getScopeLabel(selectedRecord)}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">导出文件</p>
                  <p className="mt-2 truncate text-sm font-semibold text-foreground" title={selectedRecord.outputFileName || "--"}>
                    {selectedRecord.outputFileName || "--"}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">记录时间</p>
                  <p className="mt-2 truncate text-sm font-semibold text-foreground">{formatDateTime(selectedRecord.createdAt)}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">原始行</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.sourceRows)}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">合并词</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.mergedRows)}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">重复词</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.duplicateTermCount)}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">订单</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.totalOrders)}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">曝光</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.totalImpressions)}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                  <p className="text-xs font-medium text-muted">销售额</p>
                  <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(selectedRecord.summary.totalSales, 2)}</p>
                </div>
              </div>
              <HistoryRowsPreview rows={selectedRecord.rows} />
            </CardContent>
            </Card>
          </div>
        ) : null}
      </div>}
    />
  );
}
