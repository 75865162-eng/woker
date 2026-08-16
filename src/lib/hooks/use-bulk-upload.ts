"use client";

import { useRef } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WorkspaceDatasetPayload } from "@/lib/types";
import type { SheetRow } from "@/lib/workspace/workspace-import";
import { addWorkspaceScopeToFormData, scopedApiPath, scopedFetch } from "@/lib/workspace/scoped-fetch";

type ImportJobResponse = {
  job?: {
    id: string;
    status: "queued" | "running" | "done" | "failed";
    progress: number;
    error?: string | null;
    workspaceDataset?: WorkspaceDatasetPayload | null;
  };
  error?: string;
};

type DatasetResponse = {
  dataset?: WorkspaceDatasetPayload | null;
  error?: string;
};

type BulkParseWorkerMessage =
  | { type: "start"; sheets: string[]; workbookSheets: string[] }
  | { type: "chunk"; sheetName: string; rows: SheetRow[]; startRowIndex?: number; progress: number }
  | { type: "complete"; rowCount: number; sheets: string[] }
  | { type: "error"; message: string };

const amazonBulkTargetSheets = [
  "商品推广活动",
  "Sponsored Products Campaigns",
  "Bulk Operations",
  "Sponsored Products",
];

function isSupportedFile(file: File) {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(file.name);
}

function parseBulkLocally(buffer: ArrayBuffer) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/excel-parser.worker.ts", import.meta.url), {
      type: "module",
    });
    const setParseProgress = useWorkspaceStore.getState().setParseProgress;
    const ingestParsedRows = useWorkspaceStore.getState().ingestParsedRows;
    const setParseCompleted = useWorkspaceStore.getState().setParseCompleted;
    const setParseFailed = useWorkspaceStore.getState().setParseFailed;

    worker.onmessage = (event: MessageEvent<BulkParseWorkerMessage>) => {
      const message = event.data;

      if (message.type === "start") {
        setParseProgress(10, message.sheets);
        return;
      }

      if (message.type === "chunk") {
        ingestParsedRows(message.sheetName, message.rows, message.startRowIndex ?? 0);
        setParseProgress(Math.max(10, message.progress), [message.sheetName]);
        return;
      }

      if (message.type === "complete") {
        setParseCompleted(message.rowCount, message.sheets);
        worker.terminate();
        resolve();
        return;
      }

      if (message.type === "error") {
        setParseFailed(message.message);
        worker.terminate();
        reject(new Error(message.message));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message || "浏览器解析 Bulk 文件失败。"));
    };

    worker.postMessage({
      file: buffer,
      targetSheets: amazonBulkTargetSheets,
      chunkSize: 1000,
    });
  });
}

export function useBulkUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setParseStarted = useWorkspaceStore((state) => state.setParseStarted);
  const setParseProgress = useWorkspaceStore((state) => state.setParseProgress);
  const applyWorkspaceDataset = useWorkspaceStore((state) => state.applyWorkspaceDataset);
  const setParseFailed = useWorkspaceStore((state) => state.setParseFailed);

  async function readJob(jobId: string) {
    const response = await scopedFetch(`/api/jobs/${jobId}`);
    const data = (await response.json().catch(() => ({}))) as ImportJobResponse;

    if (!response.ok) {
      throw new Error(data.error || "读取导入任务失败。");
    }

    if (!data.job) {
      throw new Error("导入任务不存在。");
    }

    return data.job;
  }

  async function readDataset(jobId: string) {
    const response = await scopedFetch(scopedApiPath(`/api/workspace/datasets?jobId=${encodeURIComponent(jobId)}`));
    const data = (await response.json().catch(() => ({}))) as DatasetResponse;

    if (!response.ok) {
      throw new Error(data.error || "读取 WorkspaceDataset 失败。");
    }

    if (!data.dataset) {
      throw new Error("导入任务已完成，但未找到结构化 WorkspaceDataset。");
    }

    return data.dataset;
  }

  async function waitForDataset(jobId: string, options: { updateProgress?: boolean } = {}) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 120_000) {
      const job = await readJob(jobId);

      if (options.updateProgress !== false) {
        setParseProgress(Math.max(10, job.progress || 10));
      }

      if (job.workspaceDataset) {
        return job.workspaceDataset;
      }

      if (job.status === "done") {
        return job.workspaceDataset ?? readDataset(jobId);
      }

      if (job.status === "failed") {
        try {
          return await readDataset(jobId);
        } catch {
          // Keep the original worker failure visible when no dataset was produced.
        }
        throw new Error(job.error || "后端 Worker 解析 Bulk 文件失败。");
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }

    throw new Error("导入任务仍在队列中，请确认 Worker 正在运行后稍后刷新工作区。");
  }

  async function handleFileSelected(file?: File) {
    if (!file) {
      return;
    }

    if (!isSupportedFile(file)) {
      setParseFailed("请上传 Amazon Bulk Operations 的 .xlsx、.xls、.xlsm 或 .csv 文件。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      setParseStarted(file.name, buffer.slice(0));

      const localParse = parseBulkLocally(buffer.slice(0));
      const remoteDatasetResult = uploadBulkAndWaitForDataset(file).then(
        (dataset) => ({ dataset }),
        (error: unknown) => ({ error }),
      );

      await localParse;
      const result = await remoteDatasetResult;

      if ("error" in result) {
        throw result.error;
      }

      const { dataset } = result;
      applyWorkspaceDataset(dataset, buffer.slice(0));
    } catch (error) {
      setParseFailed(error instanceof Error ? error.message : "上传或解析文件失败。");
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

  async function uploadBulkAndWaitForDataset(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("type", "bulk_upload");
    addWorkspaceScopeToFormData(formData);

    const uploadResponse = await scopedFetch("/api/files/upload", {
      method: "POST",
      body: formData,
    });
    const uploadData = (await uploadResponse.json().catch(() => ({}))) as ImportJobResponse;

    if (!uploadResponse.ok || !uploadData.job) {
      throw new Error(uploadData.error || "创建导入任务失败。");
    }

    return uploadData.job.workspaceDataset ?? waitForDataset(uploadData.job.id, { updateProgress: false });
  }
}
