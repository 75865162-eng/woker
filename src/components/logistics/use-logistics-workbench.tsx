"use client";

import { useMemo, useState } from "react";
import { Download, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type DataTableColumn } from "@/components/ui/data-table";
import type { AProductRow, LogisticsLogEntry, LogisticsWorkspaceState, PdfSummary, UploadedFileState } from "@/lib/logistics/types";
import { downloadBlob, downloadFilesAsZip, formatMetricNumber, makeId } from "@/lib/logistics/utils";
import { SLOW_PARSE_WARNING_BYTES, initialState, type FileSlot } from "./use-logistics-workbench-model";
import { buildLogisticsTaskSummary, getVisibleLogisticsRows, logisticsToneForLog } from "./logistics-workbench-tables";
export function useLogisticsWorkbench() {
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

  const loadAWorkbookForImageExports = async () => {
    if (!rawFiles.a) {
      return state.aSummary;
    }

    if (state.aSummary && !state.aSummary.imageParsingSkipped) {
      return state.aSummary;
    }

    const { parseLogisticsAWorkbook } = await import("@/lib/logistics/jobs");
    const aSummary = await parseLogisticsAWorkbook(rawFiles.a, { skipImages: false });
    setState((current) => ({
      ...current,
      aSummary,
    }));
    return aSummary;
  };

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

        if (shouldWarnSlow) {
          pushLog({
            level: "warning",
            message: "A表超过 30MB，解析可能较慢，但图片会延后到 D 表/对比表生成时再读取。",
          });
        }

        const { parseLogisticsAWorkbook } = await import("@/lib/logistics/jobs");
        const aSummary = await parseLogisticsAWorkbook(file, { skipImages: true });
        setState((current) => ({
          ...current,
          aFile: setUploadedFileState(slot, file),
          aSummary,
        }));
        pushLog({
          level: "success",
          message: aSummary.imageParsingSkipped
            ? `A表已快速解析，读取业务 sheet：${aSummary.latestSheetName}。图片将在生成 D 表/对比表时再读取。`
            : `A表已解析，读取业务 sheet：${aSummary.latestSheetName}`,
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
      const aSummary = await loadAWorkbookForImageExports();
      if (!aSummary) {
        pushLog({ level: "warning", message: "生成物流发票前请先上传 A 表" });
        return;
      }
      const results = await buildLogisticsDWorkbooks({
        aSummary,
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
      const aSummary = await loadAWorkbookForImageExports();
      if (!aSummary) {
        pushLog({ level: "warning", message: "生成创货件对比表前请先上传 A 表" });
        return;
      }
      const result = await buildLogisticsComparisonWorkbook(aSummary, state.pdfSummaries);
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

  const taskSummary = useMemo(() => buildLogisticsTaskSummary(state), [state]);
  const visibleARows = useMemo(() => getVisibleLogisticsRows(state), [state]);
  const toneForLog = logisticsToneForLog;
  const taskColumns: DataTableColumn<PdfSummary>[] = [
    { key: "shipmentTitle", header: "货件标题", className: "font-semibold", render: (item) => item.shipmentTitle || "--" },
    { key: "shipmentName", header: "货件号", className: "font-semibold", render: (item) => item.shipmentName || "--" },
    { key: "warehouseCode", header: "仓库", render: (item) => item.warehouseCode || "--" },
    { key: "fbaCode", header: "FBA编号", render: (item) => item.fbaCode || "--" },
    { key: "totalBoxes", header: "箱数", numeric: true, render: (item) => formatMetricNumber(item.totalBoxes) },
    { key: "pages", header: "页数", numeric: true, render: (item) => formatMetricNumber(item.pages.length) },
    { key: "channelName", header: "渠道", render: (item) => item.channelName || "--" },
    { key: "actions", header: "操作", render: (_item, index) => (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => handleDownloadRenamedPdf(index)}><FileArchive className="h-4 w-4" />下载箱唛</Button>
        <Button size="sm" onClick={() => handleDownloadInvoiceTemplate(index)} disabled={!state.dExports[index]}><Download className="h-4 w-4" />下载发票</Button>
      </div>
    ) },
  ];
  const aPreviewColumns: DataTableColumn<AProductRow>[] = [
    { key: "sku", header: "SKU", className: "font-semibold", render: (row) => row.sku || "--" },
    { key: "productName", header: "品名", render: (row) => row.productName || "--" },
    { key: "hsCode", header: "海关编码", render: (row) => row.hsCode || "--" },
    { key: "purchaseCost", header: "采购成本", numeric: true, render: (row) => formatMetricNumber(row.purchaseCost, 2) },
    { key: "totalShipment", header: "发货总数", numeric: true, render: (row) => formatMetricNumber(row.totalShipment) },
    { key: "boxMap", header: "箱号分布", className: "text-xs text-muted", render: (row) => Object.entries(row.boxMap).map(([box, qty]) => `${box}:${qty}`).join(" / ") || "--" },
  ];

  const downloadExport = (kind: "bExport" | "saihuExport" | "cExport" | "summaryExport" | "compareExport") => {
    const result = state[kind];
    if (!result) {
      pushLog({ level: "warning", message: "当前还没有可下载的导出文件" });
      return;
    }
    downloadBlob(result.blob, result.fileName);
  };

return { state, processingSlot, handleFileUpload, downloadExport, handleBuildB, handleBuildSaihu, rawFiles, handleBuildC, handleDownloadRenamedPdf, handlePdfUploads, busy, setState, handleDownloadInvoiceTemplate, handleBuildD, taskColumns, taskSummary, toneForLog, visibleARows, aPreviewColumns, handleBuildComparison };
}
