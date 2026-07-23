"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, SearchCheck, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildSaihuSearchMergeWorkbook,
  createSaihuSearchMergeFileName,
  mergeSaihuSearchTerms,
} from "@/lib/saihu-search-merge/merge";
import { createSaihuHistoryId, saveSaihuHistoryRecord } from "@/lib/saihu-search-merge/history";
import type { SaihuMergeResult, SaihuMergedRow } from "@/lib/saihu-search-merge/types";

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

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${(value * 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function isSupportedFile(file: File) {
  return /\.(xlsx|xls|csv)$/iu.test(file.name);
}

function MetricCard({ label, value, tone = "gray" }: { label: string; value: string; tone?: "gray" | "blue" | "green" | "amber" }) {
  return (
    <div className="rounded-md border border-border bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Badge tone={tone}>{tone === "green" ? "合并" : "统计"}</Badge>
      </div>
      <p className="mt-2 text-xl font-bold metric-tabular text-foreground">{value}</p>
    </div>
  );
}

function PreviewTable({ rows }: { rows: SaihuMergedRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="max-h-[520px] overflow-auto thin-scrollbar">
        <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-muted text-xs font-semibold text-muted">
            <tr>
              <th className="w-[260px] border-b border-border px-3 py-2">用户搜索词</th>
              <th className="border-b border-border px-3 py-2">翻译</th>
              <th className="border-b border-border px-3 py-2 text-right">订单</th>
              <th className="border-b border-border px-3 py-2 text-right">曝光</th>
              <th className="border-b border-border px-3 py-2 text-right">点击</th>
              <th className="border-b border-border px-3 py-2 text-right">花费</th>
              <th className="border-b border-border px-3 py-2 text-right">销售额</th>
              <th className="border-b border-border px-3 py-2 text-right">CPC</th>
              <th className="border-b border-border px-3 py-2 text-right">CPA</th>
              <th className="border-b border-border px-3 py-2 text-right">CTR</th>
              <th className="border-b border-border px-3 py-2 text-right">ACoS</th>
              <th className="border-b border-border px-3 py-2 text-right">来源行</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {rows.map((row) => (
              <tr key={row.searchTerm} className="hover:bg-surface-muted/50">
                <td className="px-3 py-2 font-semibold text-foreground">{row.searchTerm}</td>
                <td className="px-3 py-2 text-muted">{row.translation || "--"}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.orderCount)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.impressions)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.clicks)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.spend, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.sales, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.cpc, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.cpa, 2)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatPercent(row.ctr)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatPercent(row.acos)}</td>
                <td className="px-3 py-2 text-right metric-tabular">{formatNumber(row.sourceRows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SaihuSearchMergeWorkbench() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<SaihuMergeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRows = useMemo(() => result?.rows.slice(0, 80) ?? [], [result]);

  const handleFile = async (selectedFile: File | null) => {
    if (!selectedFile) {
      return;
    }

    if (!isSupportedFile(selectedFile)) {
      setError("请上传 .xlsx、.xls 或 .csv 文件。");
      setResult(null);
      setFile(null);
      return;
    }

    setBusy(true);
    setError(null);
    setFile(selectedFile);
    setResult(null);

    try {
      const merged = await mergeSaihuSearchTerms(selectedFile);
      setResult(merged);
      await saveSaihuHistoryRecord({
        id: createSaihuHistoryId("upload"),
        action: "upload",
        createdAt: new Date().toISOString(),
        sourceFileName: selectedFile.name,
        summary: merged.summary,
        rows: merged.rows,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件解析失败。");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!result || !file) {
      return;
    }

    const blob = buildSaihuSearchMergeWorkbook(result);
    const outputFileName = createSaihuSearchMergeFileName(file.name);
    downloadBlob(blob, outputFileName);
    await saveSaihuHistoryRecord({
      id: createSaihuHistoryId("export"),
      action: "export",
      createdAt: new Date().toISOString(),
      sourceFileName: file.name,
      outputFileName,
      outputBlob: blob,
      summary: result.summary,
      rows: result.rows,
    });
  };

  return (
    <>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>搜索词报表上传</CardTitle>
                <p className="mt-1 text-sm text-muted">支持 .xlsx、.xls、.csv。原表不会被修改，导出时生成新的合并结果文件。</p>
              </div>
              <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
                <UploadCloud className="h-4 w-4" />
                选择文件
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex min-h-[150px] w-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/50 px-6 py-8 text-center transition-colors hover:border-brand hover:bg-white disabled:pointer-events-none disabled:opacity-70"
            >
              <FileSpreadsheet className="h-10 w-10 text-brand" />
              <span className="mt-3 text-sm font-semibold text-foreground">{file ? file.name : "点击上传赛狐搜索词报表"}</span>
              <span className="mt-1 text-xs text-muted">{busy ? "正在解析并合并数据..." : "系统会按用户搜索词去重，并重算 CPC、CPA、CTR、ACoS 等指标"}</span>
            </button>

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {result ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="原始有效行数" value={formatNumber(result.summary.sourceRows)} />
              <MetricCard label="合并后搜索词" value={formatNumber(result.summary.mergedRows)} tone="green" />
              <MetricCard label="重复搜索词" value={formatNumber(result.summary.duplicateTermCount)} tone="amber" />
              <MetricCard label="广告订单量" value={formatNumber(result.summary.totalOrders)} tone="blue" />
              <MetricCard label="广告销售额" value={formatNumber(result.summary.totalSales, 2)} tone="blue" />
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>合并结果预览</CardTitle>
                    <p className="mt-1 text-sm text-muted">当前展示前 {formatNumber(previewRows.length)} 行，完整结果会写入导出的 Excel。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="green" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      已完成
                    </Badge>
                    <Button onClick={() => void handleExport()}>
                      <Download className="h-4 w-4" />
                      导出合并表
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <PreviewTable rows={previewRows} />
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3 text-sm text-muted">
              <SearchCheck className="h-5 w-5 text-brand" />
              上传后会在这里显示合并摘要和搜索词预览。
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
