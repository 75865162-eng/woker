"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, ServerCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkerHealthPayload = {
  driver: string;
  queueName: string;
  queueCounts: Record<string, number>;
  workers: Array<{
    id: string;
    workerName: string;
    queueName: string;
    status: string;
    concurrency: number;
    lastSeenAt: string;
    online: boolean;
  }>;
  recentJobs: Array<{
    id: string;
    status: string;
    progress: number;
    error?: string | null;
    updatedAt: string;
    file?: {
      originalName: string;
    };
  }>;
  error?: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function WorkerHealthPanel() {
  const [data, setData] = useState<WorkerHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadHealth() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/system/worker-health", { cache: "no-store" });
      const payload = (await response.json()) as WorkerHealthPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Worker 状态读取失败。");
      }

      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Worker 状态读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHealth();
  }, []);

  const counts = data?.queueCounts ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
            <ServerCog className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Redis Worker 运维</CardTitle>
            <p className="mt-0.5 text-xs font-medium text-muted">队列积压、worker 心跳和近期异常任务。</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadHealth()} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        {loading ? <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">正在读取 worker 状态...</div> : null}

        <div className="grid grid-cols-[repeat(auto-fit,104px)] justify-start gap-2">
          {["waiting", "active", "delayed", "failed", "completed", "paused"].map((key) => (
            <div key={key} className="rounded-md border border-border bg-white px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-normal text-muted">{key}</p>
              <p className="mt-1 text-xl font-black metric-tabular text-foreground">{Number(counts[key] ?? 0).toLocaleString("zh-CN")}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-bold text-foreground">Worker 心跳</p>
              <Badge tone={data?.driver === "redis" ? "green" : "amber"}>{data?.driver ?? "-"}</Badge>
            </div>
            <div className="thin-scrollbar max-h-48 overflow-auto p-2.5">
              {data?.workers.length ? (
                data.workers.map((worker) => (
                  <div key={worker.id} className="mb-1.5 rounded-md border border-border bg-surface-muted px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold text-foreground">{worker.workerName}</p>
                      <Badge tone={worker.online ? "green" : "red"}>{worker.online ? "online" : worker.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted">并发 {worker.concurrency} · {formatDate(worker.lastSeenAt)}</p>
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-sm font-medium text-muted">暂无 worker 心跳。</p>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-white">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Activity className="h-4 w-4 text-brand" />
              <p className="text-sm font-bold text-foreground">近期运行 / 失败任务</p>
            </div>
            <div className="thin-scrollbar max-h-48 overflow-auto p-2.5">
              {data?.recentJobs.length ? (
                data.recentJobs.map((job) => (
                  <div key={job.id} className="mb-1.5 rounded-md border border-border bg-surface-muted px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold text-foreground">{job.file?.originalName ?? job.id}</p>
                      <Badge tone={job.status === "failed" ? "red" : "blue"}>{job.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted">进度 {job.progress}% · {formatDate(job.updatedAt)}</p>
                    {job.error ? <p className="mt-1 line-clamp-2 text-xs font-semibold text-red-700">{job.error}</p> : null}
                  </div>
                ))
              ) : (
                <p className="py-6 text-center text-sm font-medium text-muted">暂无异常或运行中任务。</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
