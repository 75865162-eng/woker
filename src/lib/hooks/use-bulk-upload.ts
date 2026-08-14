"use client";

import { useRef } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WorkspaceDatasetPayload } from "@/lib/types";
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

function isSupportedFile(file: File) {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(file.name);
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

  async function waitForDataset(jobId: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 120_000) {
      const job = await readJob(jobId);

      setParseProgress(Math.max(10, job.progress || 10));

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
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      setParseStarted(file.name, buffer.slice(0));

      const formData = new FormData();
      formData.set("file", file);
      formData.set("type", "bulk_upload");
      addWorkspaceScopeToFormData(formData);
      setParseProgress(8);

      const uploadResponse = await scopedFetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      const uploadData = (await uploadResponse.json().catch(() => ({}))) as ImportJobResponse;

      if (!uploadResponse.ok || !uploadData.job) {
        throw new Error(uploadData.error || "创建导入任务失败。");
      }

      setParseProgress(Math.max(12, uploadData.job.progress || 12));
      const dataset = uploadData.job.workspaceDataset ?? await waitForDataset(uploadData.job.id);
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
}
