"use client";

import { useRef } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const targetSheets = ["商品推广活动", "Sponsored Products Campaigns", "Bulk Operations", "Sponsored Products"];

type WorkerMessage = {
  type: "start" | "chunk" | "complete" | "error";
  progress?: number;
  rowCount?: number;
  sheets?: string[];
  workbookSheets?: string[];
  sheetName?: string;
  startRowIndex?: number;
  rows?: Record<string, string | number | boolean | null>[];
  message?: string;
};

function isSupportedFile(file: File) {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(file.name);
}

export function useBulkUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseProgress = useWorkspaceStore((state) => state.parseProgress);
  const setParseStarted = useWorkspaceStore((state) => state.setParseStarted);
  const setParseProgress = useWorkspaceStore((state) => state.setParseProgress);
  const ingestParsedRows = useWorkspaceStore((state) => state.ingestParsedRows);
  const setParseCompleted = useWorkspaceStore((state) => state.setParseCompleted);
  const setParseFailed = useWorkspaceStore((state) => state.setParseFailed);

  async function handleFileSelected(file?: File) {
    if (!file) {
      return;
    }

    if (!isSupportedFile(file)) {
      setParseFailed("请上传 Amazon Bulk Operations 的 .xlsx、.xls、.xlsm 或 .csv 文件。");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      setParseStarted(file.name, buffer.slice(0));
      const worker = new Worker(new URL("../../workers/excel-parser.worker.ts", import.meta.url), { type: "module" });

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;

        if (message.type === "start") {
          setParseProgress(5, message.sheets ?? []);
        }

        if (message.type === "chunk") {
          setParseProgress(message.progress ?? parseProgress, message.sheets);
          if (message.sheetName && message.rows) {
            ingestParsedRows(message.sheetName, message.rows, message.startRowIndex ?? 0);
          }
        }

        if (message.type === "complete") {
          setParseCompleted(message.rowCount ?? 0, message.sheets ?? []);
          worker.terminate();
        }

        if (message.type === "error") {
          setParseFailed(message.message ?? "Excel 解析失败，请检查文件格式。");
          worker.terminate();
        }
      };

      worker.onerror = () => {
        setParseFailed("解析 Worker 启动失败，请重试或检查文件是否损坏。");
        worker.terminate();
      };

      worker.postMessage({ file: buffer, targetSheets, chunkSize: 2000 }, [buffer]);
    } catch (error) {
      setParseFailed(error instanceof Error ? error.message : "读取文件失败。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return {
    fileInputRef,
    handleFileSelected,
  };
}
