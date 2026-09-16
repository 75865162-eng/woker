"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Database, Download, RefreshCcw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="max-h-[380px] overflow-auto thin-scrollbar">
        <table className="min-w-[980px] w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-muted text-xs font-semibold text-muted">
            <tr>
              <th className="border-b border-border px-3 py-2">搜索词</th>
              <th className="border-b border-border px-3 py-2">翻译</th>
              <th className="border-b border-border px-3 py-2 text-right">订单</th>
              <th className="border-b border-border px-3 py-2 text-right">曝光</th>
              <th className="border-b border-border px-3 py-2 text-right">点击</th>
              <th className="border-b border-border px-3 py-2 text-right">花费</th>
              <th className="border-b border-border px-3 py-2 text-right">销售额</th>
              <th className="border-b border-border px-3 py-2 text-right">来源行</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {previewRows.map((row) => (
              <tr key={row.searchTerm} className="hover:bg-surface-muted/50">
                <td className="max-w-[220px] truncate px-3 py-2 font-medium text-foreground" title={row.searchTerm}>
                  {row.searchTerm}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-muted" title={row.translation}>
                  {row.translation || "--"}
                </td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.orderCount)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.impressions)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.clicks)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.spend, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.sales, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.sourceRows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

  return (
    <>
      <div className="space-y-5">
        <Card>
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
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-5">
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
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-brand" />
                <CardTitle>记录明细</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm text-muted">
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
                  className="rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none"
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
              <div className="overflow-hidden rounded-md border border-border">
                  <div className="max-h-[620px] overflow-auto thin-scrollbar">
                    <table className="min-w-[1060px] w-full table-fixed border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-surface-muted text-xs font-semibold text-muted">
                      <tr>
                        <th className="w-[180px] border-b border-border px-3 py-2">时间</th>
                        <th className="w-[100px] border-b border-border px-3 py-2">动作</th>
                        <th className="w-[100px] border-b border-border px-3 py-2">源文件</th>
                        <th className="w-[100px] border-b border-border px-3 py-2">导出文件</th>
                        <th className="border-b border-border px-3 py-2 text-right">原始行</th>
                        <th className="border-b border-border px-3 py-2 text-right">合并词</th>
                        <th className="border-b border-border px-3 py-2 text-right">重复词</th>
                        <th className="border-b border-border px-3 py-2 text-right">订单</th>
                        <th className="border-b border-border px-3 py-2 text-right">曝光</th>
                        <th className="border-b border-border px-3 py-2 text-right">点击</th>
                        <th className="border-b border-border px-3 py-2 text-right">花费</th>
                        <th className="border-b border-border px-3 py-2 text-right">销售额</th>
                        <th className="w-[200px] border-b border-border px-3 py-2 text-right">文件</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-white">
                      {records.map((record) => (
                        <tr key={record.id} className={`hover:bg-surface-muted/50 ${record.id === selectedRecordId ? "bg-brand/5" : ""}`}>
                          <td className="whitespace-nowrap px-3 py-2 metric-tabular text-muted">{formatDateTime(record.createdAt)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge tone={record.action === "export" ? "green" : "blue"} className="min-w-[84px] justify-center whitespace-nowrap px-2">
                              {getActionLabel(record.action)}
                            </Badge>
                          </td>
                          <td className="max-w-[100px] truncate px-3 py-2 font-medium text-foreground" title={record.sourceFileName}>
                            {record.sourceFileName}
                          </td>
                          <td className="max-w-[100px] truncate px-3 py-2 text-muted" title={record.outputFileName}>
                            {record.outputFileName || "--"}
                          </td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.sourceRows)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.mergedRows)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.duplicateTermCount)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.totalOrders)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.totalImpressions)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.totalClicks)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.totalSpend, 2)}</td>
                          <td className="px-3 py-2 text-right metric-tabular">{formatNumber(record.summary.totalSales, 2)}</td>
                          <td className="w-[200px] px-3 py-2 text-right">
                            <div className="flex justify-end gap-2 whitespace-nowrap">
                              <Button size="sm" variant="secondary" className="min-w-[72px] whitespace-nowrap px-2" onClick={() => handleViewRecord(record.id)}>
                                查看
                              </Button>
                              <Button size="sm" variant="secondary" className="min-w-[84px] whitespace-nowrap px-2" onClick={() => void handleDownload(record)}>
                                <Download className="h-4 w-4" />
                                下载
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
      </div>
    </>
  );
}
