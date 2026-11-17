"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVisiblePolling } from "@/lib/hooks/use-visible-polling";
import { Download, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Toolbar, controlClassName } from "@/components/ui/toolbar";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { cn } from "@/lib/utils";

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

const statusTone: Record<ImportJobStatus, StatusTone> = {
  queued: "warning",
  running: "info",
  done: "success",
  failed: "danger",
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

function queueText(job: ImportJob) {
  if (job.status === "queued") {
    return `排队 ${formatElapsedSince(job.createdAt)} · 前方 ${job.diagnostics?.aheadCount ?? "-"} 个`;
  }

  if (job.diagnostics?.queueState === "active") return "已进入 Worker";
  if (job.status === "done") return "队列已完成";
  if (job.diagnostics?.queueState === "missing") return "队列消息不存在";

  return job.diagnostics?.queueState ?? "-";
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

  useVisiblePolling({
    intervalMs: 5_000,
    enabled: jobs.some((job) => job.status === "queued" || job.status === "running"),
    onPoll: () => {
      backgroundRefreshRef.current = true;
      setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }));
    },
  });

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

  function goToPage(page: number) {
    backgroundRefreshRef.current = false;
    setQuery((current) => ({ ...current, page }));
  }

  const columns: DataTableColumn<ImportJob>[] = [
    {
      key: "file",
      header: "文件",
      width: 280,
      render: (job) => (
        <>
          <span className="block truncate font-semibold text-foreground" title={job.file?.originalName ?? job.id}>
            {job.file?.originalName ?? job.id}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {formatSize(job.file?.size)} · {formatDate(job.createdAt)}
          </span>
          {job.error ? (
            <span className="mt-0.5 block truncate text-xs font-semibold text-danger" title={job.error}>
              {job.error}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "type",
      header: "类型",
      width: 104,
      render: (job) => <span className="block truncate text-sm text-muted">{typeLabel[job.type] ?? job.type}</span>,
    },
    {
      key: "status",
      header: "队列状态",
      width: 184,
      render: (job) => (
        <>
          <StatusPill tone={job.diagnostics?.suspectedStuck ? "danger" : statusTone[job.status]}>
            {job.diagnostics?.suspectedStuck ? "疑似卡死" : statusLabel[job.status]}
          </StatusPill>
          <span className="mt-1 block truncate text-xs text-muted" title={queueText(job)}>
            {queueText(job)}
          </span>
        </>
      ),
    },
    {
      key: "worker",
      header: "Worker",
      width: 148,
      render: (job) => (
        <>
          <StatusPill
            tone={job.diagnostics?.workerHasTask ? "success" : job.diagnostics?.workerOnline ? "info" : "danger"}
            dot
          >
            {job.diagnostics?.workerHasTask ? "已领取" : job.diagnostics?.workerOnline ? "在线" : "离线"}
          </StatusPill>
          <span className="mt-1 block truncate text-xs text-muted">{job.diagnostics?.workerCount ?? 0} 个在线</span>
        </>
      ),
    },
    {
      key: "progress",
      header: "处理进度",
      width: 196,
      render: (job) => (
        <>
          <div className="h-1.5 w-full max-w-[150px] overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.min(Math.max(job.progress, 0), 100)}%` }}
            />
          </div>
          <span className="mt-1 block truncate text-xs font-semibold text-muted metric-tabular">
            {job.diagnostics && job.diagnostics.processedCount != null && job.diagnostics.totalCount != null
              ? `${job.diagnostics.processedCount.toLocaleString("zh-CN")} / ${job.diagnostics.totalCount.toLocaleString("zh-CN")} 条`
              : `${job.progress}%`}
          </span>
          {job.diagnostics?.phase ? (
            <span className="block truncate text-xs text-muted" title={job.diagnostics.phase}>
              {job.diagnostics.phase}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "times",
      header: "时间诊断",
      width: 204,
      render: (job) => (
        <span className="block text-xs leading-5 text-muted metric-tabular">
          <span className="block truncate">创建 {formatDate(job.createdAt)}</span>
          <span className="block truncate">
            开始 {job.diagnostics?.startedAt ? formatDate(job.diagnostics.startedAt) : "-"}
          </span>
          <span className="block truncate">
            更新 {formatDate(job.updatedAt)} · {formatElapsedSince(job.updatedAt)}前
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: 124,
      align: "right",
      render: (job) => (
        <span className="flex justify-end gap-1">
          {job.status === "done" && job.resultKey ? (
            <a
              href={getJobDownloadUrl(job)}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </a>
          ) : null}
          {job.status === "failed" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              disabled={retryingId === job.id}
              onClick={() => retryJob(job.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <ListPageTemplate
      header={error ? <Alert tone="danger">{error}</Alert> : null}
      filters={<Toolbar
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={refreshTasks} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        }
      >
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="状态筛选"
          className={cn(controlClassName, "w-36")}
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
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          aria-label="搜索文件名"
          className={cn(controlClassName, "w-64")}
          placeholder="搜索文件名"
        />
        <Button type="button" size="sm" variant="primary" onClick={submitSearch}>
          <Search className="h-4 w-4" />
          查询
        </Button>
      </Toolbar>}

      table={<div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          className="rounded-none border-0"
          columns={columns}
          rows={jobs}
          getRowKey={(job) => job.id}
          loading={loading}
          empty="当前范围没有任务。上传 Bulk 文件或发起商品导出后，任务会出现在这里。"
        />
      </div>}
      pagination={<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs text-muted">
          <span className="metric-tabular">
            共 {pagination.total.toLocaleString("zh-CN")} 条，第 {pagination.page} / {pagination.pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pagination.page <= 1 || loading}
              onClick={() => goToPage(pagination.page - 1)}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pagination.page >= pagination.pageCount || loading}
              onClick={() => goToPage(pagination.page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>}
    />
  );
}
