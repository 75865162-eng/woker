"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ProductFilters } from "./product-workbench-model";
import type { ProductExportNotice } from "./product-workbench-cache";

export function useProductExport(filters: ProductFilters, setActivityLog: Dispatch<SetStateAction<string[]>>) {
  const [exportingProducts, setExportingProducts] = useState(false);
  const [exportNotice, setExportNotice] = useState<ProductExportNotice | null>(null);
  const exportPollingJobsRef = useRef(new Set<string>());
  const exportPollingTimersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const pollingTimers = exportPollingTimersRef.current;
    const pollingJobs = exportPollingJobsRef.current;

    return () => {
      for (const timer of pollingTimers.values()) {
        window.clearTimeout(timer);
      }
      pollingTimers.clear();
      pollingJobs.clear();
    };
  }, []);

  async function downloadProductExport(downloadUrl: string, fileName: string) {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.click();
  }

  function stopProductExportPolling(jobId: string) {
    const timer = exportPollingTimersRef.current.get(jobId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      exportPollingTimersRef.current.delete(jobId);
    }
    exportPollingJobsRef.current.delete(jobId);
  }

  function pollProductExport(jobId: string, attempt = 0) {
    if (attempt === 0) {
      if (exportPollingJobsRef.current.has(jobId)) {
        return;
      }
      exportPollingJobsRef.current.add(jobId);
    } else if (!exportPollingJobsRef.current.has(jobId)) {
      return;
    }

    const checkStatus = async () => {
      if (attempt >= 120) {
        stopProductExportPolling(jobId);
        setExportNotice({
          tone: "info",
          message: "商品导出等待时间较长，任务仍在后台处理，请到任务中心查看进度。",
          jobId,
        });
        setActivityLog((current) => [`商品导出仍在处理中，请到任务中心查看任务 ${jobId}`, ...current].slice(0, 8));
        window.alert("商品导出等待时间较长，请到任务中心查看进度和下载文件。");
        return;
      }

      try {
        const response = await fetch(`/api/products/export/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = (await response.json()) as {
          job?: { status?: string; error?: string | null; file?: { originalName?: string } | null };
          error?: string;
        };

        if (response.ok && data.job?.status === "done") {
          const fileName = data.job.file?.originalName ?? "products.xlsx";
          await downloadProductExport(`/api/products/export/${encodeURIComponent(jobId)}/download`, fileName);
          stopProductExportPolling(jobId);
          setExportNotice({
            tone: "success",
            message: `商品导出已完成，文件已开始下载：${fileName}`,
            jobId,
          });
          setActivityLog((current) => [`商品导出已完成并自动下载 ${fileName}`, ...current].slice(0, 8));
          window.alert(`商品导出已完成，文件已开始下载：${fileName}`);
          return;
        }

        if (response.ok && data.job?.status === "failed") {
          const message = data.job.error || "商品导出失败";
          stopProductExportPolling(jobId);
          setExportNotice({
            tone: "error",
            message,
            jobId,
          });
          setActivityLog((current) => [`商品导出失败：${message}`, ...current].slice(0, 8));
          window.alert(message);
          return;
        }
      } catch {
        // 临时网络失败时继续轮询。
      }

      const nextAttempt = attempt + 1;
      const timer = window.setTimeout(() => {
        exportPollingTimersRef.current.delete(jobId);
        pollProductExport(jobId, nextAttempt);
      }, 5_000);
      exportPollingTimersRef.current.set(jobId, timer);
    };

    void checkStatus();
  }

  async function handleExportProducts() {
    if (exportingProducts) {
      return;
    }

    setExportingProducts(true);
    try {
      const params = new URLSearchParams({
        search: filters.keyword.trim(),
        asin: filters.asin.trim(),
        supplierName: filters.supplierName.trim(),
        status: filters.status,
        opsAssignees: filters.opsAssignees.join(","),
        selectionOwners: filters.selectionOwners.join(","),
        designerAssignees: filters.designerAssignees.join(","),
        mySkuOwner: filters.mySkuOwner.trim(),
        minPrice: filters.minPrice.trim(),
        maxPrice: filters.maxPrice.trim(),
      });
      const response = await fetch(`/api/products/export?${params.toString()}`, { method: "POST" });
      const data = (await response.json()) as {
        file?: { downloadUrl?: string; name?: string } | null;
        job?: { id: string; status: string; file?: { originalName?: string } | null } | null;
        queued?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "商品导出失败");
      }

      if (data.file?.downloadUrl) {
        await downloadProductExport(data.file.downloadUrl, data.file.name ?? "products.xlsx");
        setExportNotice({
          tone: "success",
          message: `商品导出已完成，文件已开始下载：${data.file.name ?? "products.xlsx"}`,
        });
        setActivityLog((current) => [`商品导出已完成并生成文件 ${data.file?.name ?? "products.xlsx"}`, ...current].slice(0, 8));
        return;
      }

      if (!data.job?.id) {
        throw new Error("商品导出任务创建失败");
      }

      setExportNotice({
        tone: "info",
        message: "商品导出任务已提交，正在后台处理。页面会每 5 秒检查一次，完成后自动下载并通知。",
        jobId: data.job.id,
      });
      setActivityLog((current) => [`商品导出任务已提交，完成后将自动下载并通知`, ...current].slice(0, 8));
      pollProductExport(data.job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品导出失败";
      setActivityLog((current) => [`商品导出失败：${message}`, ...current].slice(0, 8));
      window.alert(message);
    } finally {
      setExportingProducts(false);
    }
  }

  return { exportingProducts, exportNotice, handleExportProducts };
}
