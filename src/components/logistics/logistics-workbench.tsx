"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileArchive,
  Package,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LogisticsLogEntry, LogisticsStatusTone, LogisticsTemplateOption, LogisticsWorkspaceState, UploadedFileState } from "@/lib/logistics/types";
import { downloadBlob, downloadFilesAsZip, formatMetricNumber, makeId } from "@/lib/logistics/utils";

const SLOW_PARSE_WARNING_BYTES = 30 * 1024 * 1024;
const HEAVY_PARSE_WARNING_BYTES = 80 * 1024 * 1024;

const initialState: LogisticsWorkspaceState = {
  aFile: null,
  bFile: null,
  saihuFile: null,
  cFile: null,
  dFile: null,
  pdfFiles: [],
  aSummary: null,
  bSummary: null,
  saihuSummary: null,
  cSummary: null,
  dSummary: null,
  pdfSummaries: [],
  bExport: null,
  saihuExport: null,
  cExport: null,
  cError: null,
  summaryExport: null,
  compareExport: null,
  dExports: [],
  selectedLogisticsTemplate: "kaiqi",
  logs: [],
};

const logisticsTemplateOptions: LogisticsTemplateOption[] = [
  { id: "kaiqi", label: "凯奇", enabled: true },
  { id: "weitu", label: "为途", enabled: false },
  { id: "changhe", label: "长河", enabled: false },
  { id: "pending-4", label: "4待定", enabled: false },
  { id: "pending-5", label: "5待定", enabled: false },
  { id: "pending-6", label: "6待定", enabled: false },
];

type FileSlot = "a" | "b" | "saihu" | "c" | "d" | "pdf";

export function LogisticsWorkbench() {
  const [state, setState] = useState<LogisticsWorkspaceState>(initialState);
  const [rawFiles, setRawFiles] = useState<Partial<Record<Exclude<FileSlot, "pdf">, File>> & { pdf?: File[] }>({});
  const [busy, setBusy] = useState(false);
  const [processingSlot, setProcessingSlot] = useState<FileSlot | null>(null);

  const pushLog = (entry: Omit<LogisticsLogEntry, "id">) => {
    setState((current) => ({
      ...current,
      logs: [{ id: makeId("log"), ...entry }, ...current.logs].slice(0, 40),
    }));
  };

  const setUploadedFileState = (slot: FileSlot, file: File): UploadedFileState => ({
    name: file.name,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  });

  const handleFileUpload = async (slot: FileSlot, file: File) => {
    setBusy(true);
    setProcessingSlot(slot);
    setRawFiles((current) => ({ ...current, [slot]: file }));

    try {
      if (slot === "a") {
        setState((current) => ({
          ...current,
          aFile: setUploadedFileState(slot, file),
          aSummary: null,
          bExport: null,
          saihuExport: null,
          cExport: null,
          cError: null,
          summaryExport: null,
          compareExport: null,
          dExports: [],
        }));

        const shouldWarnSlow = file.size > SLOW_PARSE_WARNING_BYTES;
        const shouldSkipImages = file.size > HEAVY_PARSE_WARNING_BYTES;

        if (shouldWarnSlow) {
          pushLog({
            level: "warning",
            message:
              file.size > HEAVY_PARSE_WARNING_BYTES
                ? "A表超过 80MB，建议精简图片或使用服务端处理。本次将优先解析核心数据，暂不立即读取图片。"
                : "A表超过 30MB，解析可能较慢，请耐心等待。",
          });
        }

        const { parseLogisticsAWorkbook } = await import("@/lib/logistics/jobs");
        const aSummary = await parseLogisticsAWorkbook(file, { skipImages: shouldSkipImages });
        setState((current) => ({
          ...current,
          aFile: setUploadedFileState(slot, file),
          aSummary,
        }));
        pushLog({
          level: "success",
          message: aSummary.imageParsingSkipped
            ? `A表已快速解析，读取最后一个 sheet：${aSummary.latestSheetName}。已跳过图片读取以提升大文件处理速度。`
            : `A表已解析，读取最后一个 sheet：${aSummary.latestSheetName}`,
        });
      }

      if (slot === "b") {
        const { parseLogisticsBWorkbook } = await import("@/lib/logistics/jobs");
        const bSummary = await parseLogisticsBWorkbook();
        setState((current) => ({
          ...current,
          bFile: setUploadedFileState(slot, file),
          bSummary,
        }));
        pushLog({ level: bSummary.templateType === "amazon-official" ? "success" : "warning", message: `B表已识别，模板类型：${bSummary.templateType}` });
      }

      if (slot === "c") {
        const { parseLogisticsCWorkbook } = await import("@/lib/logistics/jobs");
        const cSummary = await parseLogisticsCWorkbook(file);
        setState((current) => ({
          ...current,
          cFile: setUploadedFileState(slot, file),
          cSummary,
          cError: null,
        }));
        pushLog({ level: "success", message: `C表已解析，识别箱数 ${cSummary.totalBoxes}` });
      }

      if (slot === "saihu") {
        const { parseLogisticsSaihuWorkbook } = await import("@/lib/logistics/jobs");
        const saihuSummary = await parseLogisticsSaihuWorkbook(file);
        setState((current) => ({
          ...current,
          saihuFile: setUploadedFileState(slot, file),
          saihuSummary,
        }));
        pushLog({ level: "success", message: `赛狐模板已识别，默认店铺值：${saihuSummary.defaultStore || "未识别"}` });
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "文件解析失败";
      pushLog({ level: "error", message });
    } finally {
      setProcessingSlot(null);
      setBusy(false);
    }
  };

  const handlePdfUploads = async (files: File[]) => {
    if (!files.length) {
      return;
    }

    setBusy(true);
    setRawFiles((current) => ({ ...current, pdf: files }));

    try {
      const { parseLogisticsPdfFiles } = await import("@/lib/logistics/jobs");
      const summaries = await parseLogisticsPdfFiles(files);
      setState((current) => ({
        ...current,
        pdfFiles: files.map((file) => setUploadedFileState("pdf", file)),
        pdfSummaries: summaries,
      }));
      pushLog({
        level: "success",
        message: `已识别 ${summaries.length} 个 PDF，共 ${summaries.reduce((sum, item) => sum + item.pages.length, 0)} 页，并提取货件标题用于重命名和任务总览`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF 解析失败";
      pushLog({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  const handleBuildC = async () => {
    if (!rawFiles.c || !state.aSummary) {
      pushLog({ level: "warning", message: "生成 C 表前请先上传 A 表和 C 表" });
      return;
    }

    if (state.cSummary && state.cSummary.totalBoxes === 0) {
      pushLog({ level: "error", message: "当前 C 表没有识别到任何箱号列，请重新上传或检查模板结构" });
      return;
    }

    setBusy(true);
    try {
      const { buildLogisticsCWorkbook } = await import("@/lib/logistics/jobs");
      const result = await buildLogisticsCWorkbook(rawFiles.c, state.aSummary);
      setState((current) => ({ ...current, cExport: result, cError: null }));
      pushLog({ level: "success", message: `C表已生成：${result.fileName}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成 C 表失败";
      setState((current) => ({ ...current, cError: message, cExport: null }));
      pushLog({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  const handleBuildD = async () => {
    if (!state.aSummary || !state.pdfSummaries.length) {
      pushLog({ level: "warning", message: "生成物流发票前请先上传 A 表和 PDF" });
      return;
    }

    if (state.selectedLogisticsTemplate !== "kaiqi") {
      pushLog({ level: "warning", message: "当前只支持凯奇模板，其他模板待接入" });
      return;
    }

    setBusy(true);
    try {
      const { buildLogisticsDWorkbooks } = await import("@/lib/logistics/jobs");
      const results = await buildLogisticsDWorkbooks({
        aSummary: state.aSummary,
        pdfSummaries: state.pdfSummaries,
        templateId: state.selectedLogisticsTemplate,
      });
      setState((current) => ({ ...current, dExports: results }));
      pushLog({ level: "success", message: `已生成 ${results.length} 个凯奇物流发票文件` });
      await downloadFilesAsZip(results.map((item) => ({ fileName: item.fileName, blob: item.blob })), `物流发票_${Date.now()}.zip`);
    } catch (error) {
      pushLog({ level: "error", message: error instanceof Error ? error.message : "生成物流发票失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleBuildComparison = async () => {
    if (!state.aSummary || !state.pdfSummaries.length) {
      pushLog({ level: "warning", message: "生成创货件对比表前请先上传 A 表和 PDF" });
      return;
    }

    setBusy(true);
    try {
      const { buildLogisticsComparisonWorkbook } = await import("@/lib/logistics/jobs");
      const result = await buildLogisticsComparisonWorkbook(state.aSummary, state.pdfSummaries);
      setState((current) => ({
        ...current,
        compareExport: result,
      }));
      pushLog({ level: "success", message: `创货件对比表已生成：${result.fileName}` });
      downloadBlob(result.blob, result.fileName);
    } catch (error) {
      pushLog({ level: "error", message: error instanceof Error ? error.message : "生成创货件对比表失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleBuildB = async (autoDownload = false) => {
    if (!state.aSummary) {
      pushLog({ level: "warning", message: "下载 B 表前请先上传 A 表" });
      return;
    }

    setBusy(true);
    try {
      const { buildLogisticsBWorkbook } = await import("@/lib/logistics/jobs");
      const result = await buildLogisticsBWorkbook(state.aSummary);
      setState((current) => ({
        ...current,
        bExport: result,
      }));
      pushLog({ level: "success", message: `B表已生成：${result.fileName}` });
      if (autoDownload) {
        downloadBlob(result.blob, result.fileName);
      }
    } catch (error) {
      pushLog({ level: "error", message: error instanceof Error ? error.message : "生成 B 表失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleBuildSaihu = async (autoDownload = false) => {
    if (!rawFiles.saihu || !state.aSummary) {
      pushLog({ level: "warning", message: "生成赛狐模板前请先上传 A 表和赛狐模板" });
      return;
    }

    setBusy(true);
    try {
      const { buildLogisticsSaihuWorkbook } = await import("@/lib/logistics/jobs");
      const result = await buildLogisticsSaihuWorkbook(rawFiles.saihu, state.aSummary);
      setState((current) => ({
        ...current,
        saihuExport: result,
      }));
      pushLog({ level: "success", message: `赛狐模板已生成：${result.fileName}` });
      if (autoDownload) {
        downloadBlob(result.blob, result.fileName);
      }
    } catch (error) {
      pushLog({ level: "error", message: error instanceof Error ? error.message : "生成赛狐模板失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadRenamedPdf = async (index?: number) => {
    const files = rawFiles.pdf ?? [];
    if (!files.length || !state.pdfSummaries.length) {
      pushLog({ level: "warning", message: "请先上传 PDF 文件" });
      return;
    }

    if (typeof index === "number") {
      const file = files[index];
      const summary = state.pdfSummaries[index];
      if (!file || !summary) {
        pushLog({ level: "warning", message: "未找到对应 PDF" });
        return;
      }
      downloadBlob(file, summary.renamedFileName);
      return;
    }

    const renamedFiles = files
      .map((file, fileIndex) => {
        const summary = state.pdfSummaries[fileIndex];
        if (!summary) {
          return null;
        }

        return {
          fileName: summary.renamedFileName,
          blob: file,
        };
      })
      .filter(Boolean) as { fileName: string; blob: Blob }[];

    if (!renamedFiles.length) {
      pushLog({ level: "warning", message: "没有可下载的 PDF 文件" });
      return;
    }

    await downloadFilesAsZip(renamedFiles, `箱唛PDF_${Date.now()}.zip`);
    pushLog({ level: "success", message: `已打包下载 ${renamedFiles.length} 个重命名后的箱唛 PDF` });
  };

  const handleDownloadInvoiceTemplate = async (index?: number) => {
    if (!state.dExports.length) {
      pushLog({ level: "warning", message: "请先生成物流发票" });
      return;
    }

    if (typeof index === "number") {
      const target = state.dExports[index];
      if (!target) {
        pushLog({ level: "warning", message: "未找到对应物流发票文件" });
        return;
      }
      downloadBlob(target.blob, target.fileName);
      return;
    }

    await downloadFilesAsZip(state.dExports.map((item) => ({ fileName: item.fileName, blob: item.blob })), `物流发票_${Date.now()}.zip`);
  };

  const taskSummary = useMemo(() => {
    const primaryPdfSummary = state.pdfSummaries[0] ?? null;
    const activeARows = (state.aSummary?.rows ?? []).filter((row) => row.totalShipment > 0);

    return {
      shipmentTitle: primaryPdfSummary?.shipmentTitle || "--",
      shipmentName: primaryPdfSummary?.shipmentName || "--",
      warehouseCode: primaryPdfSummary?.warehouseCode || "--",
      fbaCode: primaryPdfSummary?.fbaCode || "--",
      boxCount: primaryPdfSummary?.totalBoxes ?? state.aSummary?.totalBoxes ?? 0,
      skuCount: activeARows.length,
      totalShipment: activeARows.reduce((sum, row) => sum + row.totalShipment, 0),
      pdfCount: state.pdfSummaries.length,
      pdfPageCount: state.pdfSummaries.reduce((sum, item) => sum + item.pages.length, 0),
      warningCount: state.logs.filter((item) => item.level === "warning").length,
      errorCount: state.logs.filter((item) => item.level === "error").length,
    };
  }, [state]);

  const visibleARows = useMemo(
    () => (state.aSummary?.rows ?? []).filter((row) => row.totalShipment > 0),
    [state.aSummary],
  );

  const downloadExport = (kind: "bExport" | "saihuExport" | "cExport" | "summaryExport" | "compareExport") => {
    const result = state[kind];
    if (!result) {
      pushLog({ level: "warning", message: "当前还没有可下载的导出文件" });
      return;
    }
    downloadBlob(result.blob, result.fileName);
  };

  const toneForLog = (level: LogisticsLogEntry["level"]): LogisticsStatusTone => {
    if (level === "success") return "green";
    if (level === "warning") return "amber";
    if (level === "error") return "red";
    return "blue";
  };

  return (
    <>
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <UploadCard
              title="装箱表 A"
              description="读取最后一个 sheet，提取 SKU、发货总数、箱号分布"
              file={state.aFile}
              isProcessing={processingSlot === "a"}
              status={
                state.aSummary
                  ? [
                      state.aSummary.imageParsingSkipped ? "快速解析" : "已识别",
                      state.aSummary.imageParsingSkipped
                        ? `${state.aSummary.latestSheetName}（已跳过图片读取）`
                        : `${state.aSummary.latestSheetName}`,
                    ]
                  : undefined
              }
              onSelect={(file) => handleFileUpload("a", file)}
            />
            <TemplateLibraryCard
              saihuFile={state.saihuFile}
              saihuSummary={state.saihuSummary}
              onDownloadB={() => {
                if (state.bExport) {
                  downloadExport("bExport");
                  return;
                }
                void handleBuildB(true);
              }}
              onSaihuSelect={(file) => handleFileUpload("saihu", file)}
              onDownloadSaihu={() => {
                if (state.saihuExport) {
                  downloadExport("saihuExport");
                  return;
                }
                void handleBuildSaihu(true);
              }}
            />
            <UploadCard
              title="包装箱表 C"
              description="按 SKU 和箱号自动回填数量、重量、尺寸"
              file={state.cFile}
              status={
                state.cExport
                  ? ["已生成", state.cExport.fileName]
                  : state.cError
                    ? ["生成失败", state.cError]
                  : state.cSummary
                    ? [state.cSummary.totalBoxes === 0 ? "识别失败" : "箱数", String(state.cSummary.totalBoxes)]
                    : undefined
              }
              actionLabel="生成 C 表"
              actionDisabled={!state.aSummary || !rawFiles.c}
              onAction={handleBuildC}
              downloadLabel="下载 C 表"
              downloadDisabled={!state.cExport}
              onDownload={() => downloadExport("cExport")}
              onSelect={(file) => handleFileUpload("c", file)}
            />
            <UploadCard
              title="箱唛 PDF"
              description="读取 PDF 页面中的货件号、仓库、FBA 编号，箱数按页数计算"
              files={state.pdfFiles}
              status={state.pdfSummaries.length ? ["票数", String(state.pdfSummaries.length)] : undefined}
              downloadLabel="下载全部箱唛"
              onDownload={() => handleDownloadRenamedPdf()}
              onSelectMany={(files) => handlePdfUploads(files)}
              multiple
            />
            <LogisticsTemplateCard
              selectedTemplate={state.selectedLogisticsTemplate}
              options={logisticsTemplateOptions}
              status={state.dExports.length ? ["已生成", `${state.dExports.length} 个物流表`] : ["模板", logisticsTemplateOptions.find((item) => item.id === state.selectedLogisticsTemplate)?.label ?? "未选择"]}
              downloadDisabled={!state.aSummary || !state.pdfSummaries.length || busy || state.selectedLogisticsTemplate !== "kaiqi"}
              onTemplateChange={(value) => setState((current) => ({ ...current, selectedLogisticsTemplate: value, dExports: [] }))}
              onDownload={() => {
                if (state.dExports.length) {
                  void handleDownloadInvoiceTemplate();
                  return;
                }
                void handleBuildD();
              }}
            />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>任务总览</CardTitle>
                <p className="mt-1 text-sm text-muted">根据 PDF 页面解析结果展示货件信息，不再依赖文件名</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th className="px-3 py-2">货件标题</th>
                      <th className="px-3 py-2">货件号</th>
                      <th className="px-3 py-2">仓库</th>
                      <th className="px-3 py-2">FBA编号</th>
                      <th className="px-3 py-2">箱数</th>
                      <th className="px-3 py-2">页数</th>
                      <th className="px-3 py-2">渠道</th>
                      <th className="px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.pdfSummaries.map((item, index) => (
                      <tr key={`${item.fileNameBase}-${index}`} className="border-b border-border/70">
                        <td className="px-3 py-3 font-semibold">{item.shipmentTitle || "--"}</td>
                        <td className="px-3 py-3 font-semibold">{item.shipmentName || "--"}</td>
                        <td className="px-3 py-3">{item.warehouseCode || "--"}</td>
                        <td className="px-3 py-3">{item.fbaCode || "--"}</td>
                        <td className="px-3 py-3">{formatMetricNumber(item.totalBoxes)}</td>
                        <td className="px-3 py-3">{formatMetricNumber(item.pages.length)}</td>
                        <td className="px-3 py-3">{item.channelName || "--"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => handleDownloadRenamedPdf(index)}>
                              <FileArchive className="h-4 w-4" />
                              下载箱唛
                            </Button>
                            <Button size="sm" onClick={() => handleDownloadInvoiceTemplate(index)} disabled={!state.dExports[index]}>
                              <Download className="h-4 w-4" />
                              下载发票
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!state.pdfSummaries.length && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted">
                          上传 PDF 后，这里会按每个货件逐条展示
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-4">
                  <MetricCard label="SKU数" value={formatMetricNumber(taskSummary.skuCount)} />
                  <MetricCard label="发货总数" value={formatMetricNumber(taskSummary.totalShipment)} />
                  <MetricCard label="PDF票数" value={formatMetricNumber(taskSummary.pdfCount)} />
                  <MetricCard label="PDF页数" value={formatMetricNumber(taskSummary.pdfPageCount)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>处理日志</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted px-3 py-3">
                  {entry.level === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                  ) : entry.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
                  ) : entry.level === "error" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
                  ) : (
                    <Eye className="mt-0.5 h-4 w-4 text-info" />
                  )}
                  <div className="flex-1">
                    <Badge tone={toneForLog(entry.level)}>{entry.level}</Badge>
                    <p className="mt-1 text-sm text-foreground">{entry.message}</p>
                  </div>
                </div>
              ))}
              {!state.logs.length && <div className="py-10 text-center text-sm text-muted">上传文件或执行生成动作后将在这里记录日志</div>}
            </CardContent>
          </Card>

        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>A 表数据预览</CardTitle>
                <p className="mt-1 text-sm text-muted">展示已解析的 SKU、发货总数、海关编码与箱号分布</p>
              </div>
              {state.aSummary ? <Badge tone="green">{state.aSummary.latestSheetName}</Badge> : <Badge>等待上传</Badge>}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">品名</th>
                    <th className="px-3 py-2">海关编码</th>
                    <th className="px-3 py-2">采购成本</th>
                    <th className="px-3 py-2">发货总数</th>
                    <th className="px-3 py-2">箱号分布</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleARows.slice(0, 12).map((row) => (
                    <tr key={`${row.sku}-${row.rowIndex}`} className="border-b border-border/70">
                      <td className="px-3 py-3 font-semibold">{row.sku || "--"}</td>
                      <td className="px-3 py-3">{row.productName || "--"}</td>
                      <td className="px-3 py-3">{row.hsCode || "--"}</td>
                      <td className="px-3 py-3">{formatMetricNumber(row.purchaseCost, 2)}</td>
                      <td className="px-3 py-3">{formatMetricNumber(row.totalShipment)}</td>
                      <td className="px-3 py-3 text-xs text-muted">{Object.entries(row.boxMap).map(([box, qty]) => `${box}:${qty}`).join(" / ") || "--"}</td>
                    </tr>
                  ))}
                  {!visibleARows.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-muted">
                        上传 A 表后将在这里展示预览
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>PDF 解析列表</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleBuildComparison} disabled={!state.aSummary || !state.pdfSummaries.length || busy}>
                <Download className="h-4 w-4" />
                下载创货件对比表
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {state.pdfSummaries.map((pdf) => (
                <div key={pdf.fileNameBase} className="rounded-xl border border-border bg-surface-muted p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{pdf.renamedFileName}</p>
                      <p className="mt-1 text-xs text-muted">{pdf.shipmentTitle || "--"}</p>
                      <p className="mt-1 text-xs text-muted">
                        {pdf.shipmentName || "--"} / {pdf.warehouseCode || "--"} / {pdf.fbaCode || "--"}
                      </p>
                    </div>
                    <Badge tone="blue">{pdf.pages.length} 页</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {pdf.pages.map((page) => (
                      <div key={`${pdf.fileNameBase}-${page.pageNumber}`} className="rounded-lg border border-white/70 bg-white px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge tone="blue">第 {page.pageNumber} 页</Badge>
                            <span className="text-sm font-semibold text-foreground">{page.fbaBoxCode || "待识别箱码"}</span>
                          </div>
                          <span className="text-xs text-muted">{page.positionCode || "--"}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                          <div>货件号：{page.shipmentName || "--"}</div>
                          <div>仓库：{page.warehouseCode || "--"}</div>
                          <div>FBA编号：{page.fbaCode || "--"}</div>
                          <div>SKU类型：{page.skuType || "--"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!state.pdfSummaries.length && <div className="py-10 text-center text-sm text-muted">上传 PDF 后将在这里展示逐票、逐页解析结果</div>}
            </CardContent>
          </Card>

        </section>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>结果文件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ExportRow label="B 发货表" ready={Boolean(state.bExport)} onDownload={() => downloadExport("bExport")} />
              <ExportRow label="赛狐模板" ready={Boolean(state.saihuExport)} onDownload={() => downloadExport("saihuExport")} />
              <ExportRow label="C 包装箱表" ready={Boolean(state.cExport)} onDownload={() => downloadExport("cExport")} />
              <ExportRow label="装箱汇总表" ready={Boolean(state.summaryExport)} onDownload={() => downloadExport("summaryExport")} />
              <ExportRow label="创货件对比表" ready={Boolean(state.compareExport)} onDownload={() => downloadExport("compareExport")} />
              <ExportRow
                label="物流发票"
                ready={Boolean(state.dExports.length)}
                description={state.dExports.length ? `已生成 ${state.dExports.length} 个与 PDF 同名的物流表` : "尚未生成"}
                onDownload={() => handleDownloadInvoiceTemplate()}
              />
              <div className="rounded-lg border border-dashed border-border p-3 text-xs leading-6 text-muted">
                当前版本会为每个 PDF 生成一个同名物流表，例如 `货件3-LGB8-FBA19H4WYDTY-7箱.xlsx`。
                英文名目前优先使用系统内置映射，后续可补手动维护和缓存机制。
              </div>
            </CardContent>
          </Card>

        </section>
      </div>
    </>
  );
}

function UploadCard({
  title,
  description,
  file,
  files,
  status,
  actionLabel,
  actionDisabled,
  downloadLabel,
  downloadDisabled,
  onSelect,
  onSelectMany,
  onAction,
  onDownload,
  multiple,
  hideActions,
  templateDownloadLabel,
  templateDownloadHref,
  isProcessing,
}: {
  title: string;
  description: string;
  file?: UploadedFileState | null;
  files?: UploadedFileState[];
  status?: [string, string];
  actionLabel?: string;
  actionDisabled?: boolean;
  downloadLabel?: string;
  onSelect?: (file: File) => void;
  onSelectMany?: (files: File[]) => void;
  onAction?: () => void;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  multiple?: boolean;
  hideActions?: boolean;
  templateDownloadLabel?: string;
  templateDownloadHref?: string;
  isProcessing?: boolean;
}) {
  const defaultSupportLabel = title.includes("PDF") ? "支持一次选择多个 PDF" : "支持 Excel";
  const currentFileLabel = multiple
    ? (files?.length ? `${files.length} 个文件已上传` : "支持一次选择多个 PDF")
    : (file?.name ?? defaultSupportLabel);
  const uploadLabel = multiple ? (files?.length ? "重新上传多个文件" : "点击上传多个文件") : (file ? "重新上传文件" : "点击上传文件");
  const isStaticMode = Boolean(hideActions || templateDownloadLabel || templateDownloadHref);

  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col">
        <p className="text-sm leading-6 text-muted line-clamp-2">{description}</p>
        {isStaticMode ? (
          <div className="mt-3 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-3 text-center">
            <FileSpreadsheet className="h-12 w-12 text-brand" />
            <span className="mt-2 text-sm font-semibold text-foreground" />
            {templateDownloadHref && templateDownloadLabel ? (
              <a
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
                href={templateDownloadHref}
                download
              >
                <Download className="h-4 w-4" />
                {templateDownloadLabel}
              </a>
            ) : templateDownloadLabel ? (
              <span className="mt-3 inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-white px-3 py-2 text-xs font-medium text-muted">
                {templateDownloadLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <label className="mt-3 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-3 text-center transition-colors hover:border-brand hover:bg-white">
            <UploadCloud className="h-7 w-7 text-brand" />
            <span className="mt-2 text-sm font-semibold text-foreground">{uploadLabel}</span>
            <span className="mt-1 line-clamp-2 max-w-full overflow-hidden text-ellipsis break-all text-xs leading-5 text-muted">{currentFileLabel}</span>
            <input
              type="file"
              className="hidden"
              accept={title.includes("PDF") ? ".pdf" : ".xlsx,.xls"}
              multiple={multiple}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (multiple) {
                  if (selected.length && onSelectMany) {
                    onSelectMany(selected);
                  }
                } else if (selected[0] && onSelect) {
                  onSelect(selected[0]);
                  event.currentTarget.value = "";
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
        )}
        <div className={`mt-3 flex min-h-[52px] items-start justify-between gap-2 ${hideActions ? "invisible" : ""}`}>
          <div className="min-w-0 flex-1 space-y-2">
            {status ? (
              <div className="space-y-1">
                <Badge tone="green">{status[0]}</Badge>
                <p className="line-clamp-2 break-all text-xs text-muted">{status[1]}</p>
              </div>
            ) : (
              <Badge>{isProcessing ? "处理中" : "待上传"}</Badge>
            )}
            {isProcessing ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70">
                <div className="h-full w-2/5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
              </div>
            ) : null}
          </div>
          <div className="flex w-[142px] shrink-0 flex-col gap-2">
            {onAction && actionLabel ? (
              <Button size="sm" variant="secondary" className="w-full justify-center whitespace-nowrap" onClick={onAction} disabled={actionDisabled}>
                <Package className="h-4 w-4" />
                {actionLabel}
              </Button>
            ) : null}
            {onDownload && downloadLabel ? (
              <Button size="sm" className="w-full justify-center whitespace-nowrap" onClick={onDownload} disabled={downloadDisabled}>
                <Download className="h-4 w-4" />
                {downloadLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateLibraryCard({
  saihuFile,
  saihuSummary,
  onDownloadB,
  onSaihuSelect,
  onDownloadSaihu,
}: {
  saihuFile: UploadedFileState | null;
  saihuSummary: { defaultStore: string } | null;
  onDownloadB: () => void;
  onSaihuSelect: (file: File) => void;
  onDownloadSaihu: () => void;
}) {
  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle>发货模板 B</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col gap-3 pt-4">
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex h-[102px] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted px-4 py-3 text-center">
            <span className="text-base font-semibold text-foreground">亚马逊官方模板</span>
            <a
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-white px-5 text-sm font-medium text-foreground transition-colors hover:border-brand hover:text-brand"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                onDownloadB();
              }}
            >
              <Download className="h-4 w-4" />
              下载官方模板
            </a>
          </div>
          <div className="flex h-[102px] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted px-4 py-3 text-center">
            <FileSpreadsheet className="h-7 w-7 text-brand" />
            <span className="mt-2 text-base font-semibold text-foreground">赛狐模板</span>
            <div className="mt-4 flex items-center gap-3">
              <label className="inline-flex h-11 min-w-[86px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-medium text-foreground transition-colors hover:border-brand hover:text-brand">
                <UploadCloud className="h-4 w-4" />
                上传
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onSaihuSelect(file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <Button size="sm" className="h-11 min-w-[96px] rounded-xl px-4 text-sm font-medium" onClick={onDownloadSaihu} disabled={!saihuFile}>
                <Download className="h-4 w-4" />
                下载
              </Button>
            </div>
            <span className="sr-only">
              {saihuSummary?.defaultStore
                ? `默认店铺值：${saihuSummary.defaultStore}`
                : saihuFile?.name ?? "第一列填默认下拉值，第二列 MSKU 对应 A 表 SKU，申报数对应发货总数"}
            </span>
            <label className="sr-only">
              <UploadCloud className="h-4 w-4" />
              上传赛狐模板
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onSaihuSelect(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LogisticsTemplateCard({
  selectedTemplate,
  options,
  status,
  downloadDisabled,
  onTemplateChange,
  onDownload,
}: {
  selectedTemplate: string;
  options: LogisticsTemplateOption[];
  status?: [string, string];
  downloadDisabled?: boolean;
  onTemplateChange: (value: string) => void;
  onDownload: () => void;
}) {
  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle>物流模板 D</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[248px] flex-col">
        <div className="mt-1 flex flex-1 flex-col justify-start rounded-lg border border-dashed border-border bg-surface-muted p-4">
          <span className="text-sm font-semibold text-foreground">选择物流模板</span>
          <select
            className="mt-4 h-11 rounded-xl border border-border bg-white px-3 text-sm text-foreground outline-none transition-colors focus:border-brand"
            value={selectedTemplate}
            onChange={(event) => onTemplateChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.enabled}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted">当前已接入凯奇模板，选择后会按 PDF 数量批量生成并打包下载</p>
        </div>
        <div className="mt-3 flex min-h-[52px] items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            {status ? (
              <>
                <Badge tone="green">{status[0]}</Badge>
                <p className="line-clamp-2 break-all text-xs text-muted">{status[1]}</p>
              </>
            ) : (
              <Badge>待生成</Badge>
            )}
          </div>
          <div className="flex w-[142px] shrink-0 flex-col gap-2">
            <Button size="sm" className="w-full justify-center whitespace-nowrap" onClick={onDownload} disabled={downloadDisabled}>
              <Download className="h-4 w-4" />
              下载发票
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-[160px] min-w-[160px] rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-xs font-semibold tracking-wide text-muted">{label}</p>
      <p className="mt-3 text-2xl font-black text-foreground metric-tabular">{value}</p>
    </div>
  );
}

function ExportRow({
  label,
  ready,
  onDownload,
  description,
}: {
  label: string;
  ready: boolean;
  onDownload: () => void;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 text-brand" />
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted">{description ?? (ready ? "文件已生成，可直接下载" : "尚未生成")}</p>
        </div>
      </div>
      <Button size="sm" onClick={onDownload} disabled={!ready}>
        <Download className="h-4 w-4" />
        下载
      </Button>
    </div>
  );
}
