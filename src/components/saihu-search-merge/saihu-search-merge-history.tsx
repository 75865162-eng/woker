"use client";

import { useEffect, useState } from "react";
import { Database, Download, RefreshCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSaihuSearchMergeWorkbook, createSaihuSearchMergeFileName } from "@/lib/saihu-search-merge/merge";
import { clearSaihuHistoryRecords, listSaihuHistoryRecords } from "@/lib/saihu-search-merge/history";
import type { SaihuHistoryAction, SaihuHistoryRecord } from "@/lib/saihu-search-merge/types";

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

export function SaihuSearchMergeHistory() {
  const [records, setRecords] = useState<SaihuHistoryRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setRecords(await listSaihuHistoryRecords());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const clearHistory = async () => {
    setBusy(true);
    try {
      await clearSaihuHistoryRecords();
      setRecords([]);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (record: SaihuHistoryRecord) => {
    downloadBlob(await getHistoryDownloadBlob(record), getHistoryDownloadName(record));
  };

  return (
    <>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>后台历史记录</CardTitle>
                <p className="mt-1 text-sm text-muted">这个页面不会出现在前台工具页；手动输入 /history 查看并下载历史导出文件。</p>
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
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">总记录</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(records.length)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">上传合并</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(records.filter((item) => item.action === "upload").length)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">导出文件</p>
                <p className="mt-2 text-xl font-bold metric-tabular">{formatNumber(records.filter((item) => item.action === "export").length)}</p>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/40 px-4 py-3">
                <p className="text-xs font-medium text-muted">最近记录</p>
                <p className="mt-2 truncate text-sm font-semibold text-foreground">{records[0] ? formatDateTime(records[0].createdAt) : "--"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-brand" />
              <CardTitle>记录明细</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {records.length ? (
              <div className="overflow-hidden rounded-md border border-border">
                <div className="max-h-[620px] overflow-auto thin-scrollbar">
                  <table className="min-w-[1160px] w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-surface-muted text-xs font-semibold text-muted">
                      <tr>
                        <th className="border-b border-border px-3 py-2">时间</th>
                        <th className="border-b border-border px-3 py-2">动作</th>
                        <th className="border-b border-border px-3 py-2">源文件</th>
                        <th className="border-b border-border px-3 py-2">导出文件</th>
                        <th className="border-b border-border px-3 py-2 text-right">原始行</th>
                        <th className="border-b border-border px-3 py-2 text-right">合并词</th>
                        <th className="border-b border-border px-3 py-2 text-right">重复词</th>
                        <th className="border-b border-border px-3 py-2 text-right">订单</th>
                        <th className="border-b border-border px-3 py-2 text-right">曝光</th>
                        <th className="border-b border-border px-3 py-2 text-right">点击</th>
                        <th className="border-b border-border px-3 py-2 text-right">花费</th>
                        <th className="border-b border-border px-3 py-2 text-right">销售额</th>
                        <th className="border-b border-border px-3 py-2 text-right">文件</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-white">
                      {records.map((record) => (
                        <tr key={record.id} className="hover:bg-surface-muted/50">
                          <td className="whitespace-nowrap px-3 py-2 metric-tabular text-muted">{formatDateTime(record.createdAt)}</td>
                          <td className="px-3 py-2">
                            <Badge tone={record.action === "export" ? "green" : "blue"}>{getActionLabel(record.action)}</Badge>
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 font-medium text-foreground" title={record.sourceFileName}>
                            {record.sourceFileName}
                          </td>
                          <td className="max-w-[240px] truncate px-3 py-2 text-muted" title={record.outputFileName}>
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
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="secondary" onClick={() => void handleDownload(record)}>
                              <Download className="h-4 w-4" />
                              下载
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-surface-muted/50 px-4 py-10 text-center text-sm text-muted">
                暂无历史记录。后续在赛狐客搜词合并数据页面上传或导出后，会自动保存到这里。
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
