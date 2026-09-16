"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ImportJobStatus = "queued" | "running" | "done" | "failed";

type ImportJob = {
  id: string;
  type: string;
  status: ImportJobStatus;
  progress: number;
  error?: string | null;
  resultKey?: string | null;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  createdAt: string;
  updatedAt: string;
  diagnostics?: {
    queuePosition: number | null;
    aheadCount: number | null;
    queueMessageExists: boolean;
    queueState: "active" | "delayed" | "waiting" | "missing";
    workerOnline: boolean;
    workerCount: number;
    workerHasTask: boolean;
    startedAt: string | null;
    processedCount: number | null;
    totalCount: number | null;
    phase: string | null;
    lastUpdatedAt: string;
    ageMs: number;
    suspectedStuck: boolean;
    queueError: string | null;
  };
  file?: {
    originalName: string;
    size?: number | null;
  } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

const statusOptions = [
  { value: "", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "处理中" },
  { value: "done", label: "已完成" },
  { value: "failed", label: "失败" },
];

const statusTone: Record<ImportJobStatus, "blue" | "green" | "amber" | "red"> = {
  queued: "amber",
  running: "blue",
  done: "green",
  failed: "red",
};

const statusLabel: Record<ImportJobStatus, string> = {
  queued: "排队中",
  running: "处理中",
  done: "已完成",
  failed: "失败",
};

const typeLabel: Record<string, string> = {
  bulk_upload: "Bulk 导入",
  product_export: "商品导出",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatSize(value?: number | null) {
  if (!value) return "-";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDurationMs(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;

  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

function formatElapsedSince(value: string | undefined) {
  return value ? formatDurationMs(Date.now() - new Date(value).getTime()) : "-";
}

function getJobDownloadUrl(job: ImportJob) {
  if (job.type === "product_export") {
    return `/api/products/export/${encodeURIComponent(job.id)}/download`;
  }

  return `/api/files/${encodeURIComponent(job.id)}/download`;
}

export function TaskCenterWorkbench() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ status: "", search: "", page: 1, refreshToken: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const backgroundRefreshRef = useRef(false);

  const searchParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(pagination.pageSize),
    });

    if (query.status) params.set("status", query.status);
    if (query.search) params.set("search", query.search);

    return params;
  }, [pagination.pageSize, query]);

  useEffect(() => {
    let cancelled = false;
    const isBackgroundRefresh = backgroundRefreshRef.current;
    backgroundRefreshRef.current = false;

    if (!isBackgroundRefresh) {
      setLoading(true);
      setError("");
    }

    fetch(`/api/jobs?${searchParams.toString()}`)
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "任务列表加载失败。");
        }

        if (!cancelled) {
          setJobs(Array.isArray(data.jobs) ? data.jobs : []);
          setPagination(data.pagination ?? { page: query.page, pageSize: 25, total: 0, pageCount: 1 });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "任务列表加载失败。");
      })
      .finally(() => {
        if (!cancelled && !isBackgroundRefresh) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query.page, query.refreshToken, searchParams]);

  useEffect(() => {
    const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasActiveJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      backgroundRefreshRef.current = true;
      setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }));
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [jobs]);

  function submitSearch() {
    backgroundRefreshRef.current = false;
    setQuery((current) => ({ ...current, status, search: search.trim(), page: 1 }));
  }

  function refreshTasks() {
    backgroundRefreshRef.current = false;
    setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }));
  }

  async function retryJob(jobId: string) {
    setRetryingId(jobId);
    setError("");

    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "任务重试失败。");
      }

      refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务重试失败。");
    } finally {
      setRetryingId("");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle>任务中心</CardTitle>
          <p className="mt-1 text-xs font-medium text-muted">按当前工作区查看上传、解析、导出任务状态。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground outline-none"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-56 rounded-md border border-border px-3 text-xs font-semibold outline-none focus:border-brand"
            placeholder="搜索文件名"
          />
          <Button type="button" size="sm" variant="secondary" onClick={submitSearch}>
            <Search className="h-4 w-4" />
            查询
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={refreshTasks}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="px-3 py-2 text-left">文件</th>
                <th className="px-3 py-2 text-left">类型</th>
                <th className="px-3 py-2 text-left">队列状态</th>
                <th className="px-3 py-2 text-left">Worker</th>
                <th className="px-3 py-2 text-left">处理进度</th>
                <th className="px-3 py-2 text-left">时间诊断</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm font-semibold text-muted">加载中...</td>
                </tr>
              ) : jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-2">
                      <div className="max-w-md truncate font-semibold text-foreground">{job.file?.originalName ?? job.id}</div>
                      <div className="text-xs text-muted">{formatSize(job.file?.size)} · {formatDate(job.createdAt)}</div>
                      {job.error ? <div className="mt-1 max-w-md truncate text-xs font-semibold text-danger">{job.error}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{typeLabel[job.type] ?? job.type}</td>
                    <td className="px-3 py-2">
                      <Badge tone={job.diagnostics?.suspectedStuck ? "red" : statusTone[job.status]}>{job.diagnostics?.suspectedStuck ? "疑似卡死" : statusLabel[job.status]}</Badge>
                      <div className="mt-1 text-xs text-muted">
                        {job.status === "queued"
                          ? `排队 ${formatElapsedSince(job.createdAt)} · 前方 ${job.diagnostics?.aheadCount ?? "-"} 个`
                          : job.diagnostics?.queueState === "active"
                            ? "已进入 Worker"
                            : job.status === "done"
                              ? "队列已完成"
                              : job.diagnostics?.queueState === "missing"
                                ? "队列消息不存在"
                                : job.diagnostics?.queueState}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={job.diagnostics?.workerHasTask ? "green" : job.diagnostics?.workerOnline ? "blue" : "red"}>
                        {job.diagnostics?.workerHasTask ? "已领取" : job.diagnostics?.workerOnline ? "Worker 在线" : "Worker 离线"}
                      </Badge>
                      <div className="mt-1 text-xs text-muted">{job.diagnostics?.workerCount ?? 0} 个在线</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(Math.max(job.progress, 0), 100)}%` }} />
                      </div>
                      <div className="mt-1 text-xs font-semibold text-muted">
                        {job.diagnostics && job.diagnostics.processedCount != null && job.diagnostics.totalCount != null
                          ? `${job.diagnostics.processedCount.toLocaleString("zh-CN")} / ${job.diagnostics.totalCount.toLocaleString("zh-CN")} 条`
                          : `${job.progress}%`}
                      </div>
                      {job.diagnostics?.phase ? <div className="text-xs text-muted">{job.diagnostics.phase}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">
                      <div>创建：{formatDate(job.createdAt)}</div>
                      <div>开始：{job.diagnostics?.startedAt ? formatDate(job.diagnostics.startedAt) : "-"}</div>
                      <div>更新：{formatDate(job.updatedAt)} · {formatElapsedSince(job.updatedAt)}前</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {job.status === "done" && job.resultKey ? (
                          <a href={getJobDownloadUrl(job)} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-surface-muted">
                            <Download className="h-4 w-4" />
                            下载
                          </a>
                        ) : null}
                        {job.status === "failed" ? (
                          <Button type="button" size="sm" variant="ghost" disabled={retryingId === job.id} onClick={() => retryJob(job.id)}>
                            <RotateCcw className="h-4 w-4" />
                            重试
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm font-semibold text-muted">暂无任务</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs font-semibold text-muted">
          <span>共 {pagination.total} 条，第 {pagination.page} / {pagination.pageCount} 页</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page <= 1 || loading} onClick={() => { backgroundRefreshRef.current = false; setQuery((current) => ({ ...current, page: current.page - 1 })); }}>上一页</Button>
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => { backgroundRefreshRef.current = false; setQuery((current) => ({ ...current, page: current.page + 1 })); }}>下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
