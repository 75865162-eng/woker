"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scopedApiPath, scopedFetch } from "@/lib/workspace/scoped-fetch";

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

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatSize(value?: number | null) {
  if (!value) return "-";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
    setLoading(true);
    setError("");

    scopedFetch(`/api/jobs?${searchParams.toString()}`)
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
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query.page, query.refreshToken, searchParams]);

  function submitSearch() {
    setQuery((current) => ({ ...current, status, search: search.trim(), page: 1 }));
  }

  async function retryJob(jobId: string) {
    setRetryingId(jobId);
    setError("");

    try {
      const response = await scopedFetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "任务重试失败。");
      }

      setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }));
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
          <Button type="button" size="sm" variant="ghost" onClick={() => setQuery((current) => ({ ...current, refreshToken: current.refreshToken + 1 }))}>
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
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">进度</th>
                <th className="px-3 py-2 text-left">更新时间</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm font-semibold text-muted">加载中...</td>
                </tr>
              ) : jobs.length ? (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-2">
                      <div className="max-w-md truncate font-semibold text-foreground">{job.file?.originalName ?? job.id}</div>
                      <div className="text-xs text-muted">{formatSize(job.file?.size)} · {formatDate(job.createdAt)}</div>
                      {job.error ? <div className="mt-1 max-w-md truncate text-xs font-semibold text-danger">{job.error}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{job.type}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone[job.status]}>{statusLabel[job.status]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(Math.max(job.progress, 0), 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(job.updatedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {job.status === "done" && job.resultKey ? (
                          <a href={scopedApiPath(`/api/files/${job.id}/download`)} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-surface-muted">
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
                  <td colSpan={6} className="px-3 py-8 text-center text-sm font-semibold text-muted">暂无任务</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs font-semibold text-muted">
          <span>共 {pagination.total} 条，第 {pagination.page} / {pagination.pageCount} 页</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page <= 1 || loading} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>上一页</Button>
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
