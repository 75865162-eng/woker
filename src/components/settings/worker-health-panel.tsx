"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, ServerCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkerHealthPayload = {
  registeredWorkers?: Array<{ id: string; label: string; online: boolean; instances: number; queueReady: boolean | null; version: string | null; versionMatches: boolean; mismatchedInstances?: number; connectionMatches?: boolean | null; lastSeenAt: string | null }>;
  driver: string;
  queueName: string;
  queueAvailable?: boolean;
  queueCounts: Record<string, number>;
  imageQueueCounts?: Record<string, number>;
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
  imageWorkers?: Array<{
    id: string;
    workerName: string;
    status: string;
    concurrency: number;
    lastSeenAt: string;
    online: boolean;
  }>;
  recentImageJobs?: Array<{
    id: string;
    status: string;
    progress: number;
    error?: string | null;
    updatedAt: string;
    originalName: string;
  }>;
  productHealth?: {
    outbox: {
      queued: number;
      running: number;
      failed: number;
      staleRunning: number;
      oldestQueuedAt: string | null;
      oldestRunningAt: string | null;
      oldestFailedAt: string | null;
    };
    projections: {
      pending: number;
      processing: number;
      failed: number;
      staleFailures: number;
      oldestFailedAt: string | null;
    };
    consistency: {
      productRecords: number;
      missingSummary: number;
      staleSummary: number;
      missingText: number;
      staleText: number;
      missingProjectionStates: number;
    };
    staleAfterMs: number;
  } | null;
  error?: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function WorkerHealthPanel() {
  const [data, setData] = useState<WorkerHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);

  async function loadHealth() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/system/worker-health", { cache: "no-store" });
      const payload = (await response.json()) as WorkerHealthPayload;

      if (!response.ok) {
        throw new Error(payload.error || "Worker 状态读取失败。");
      }

      if (sequence !== loadSequence.current) return;
      setData(payload);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Worker 状态读取失败。");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const sequenceState = loadSequence;
    void loadHealth();
    return () => { sequenceState.current++; };
  }, []);

  const counts = data?.queueCounts ?? {};
  const waiting = Number(counts.waiting ?? 0);
  const active = Number(counts.active ?? 0);
  const failed = Number(counts.failed ?? 0);
  const delayed = Number(counts.delayed ?? 0);
  const imageCounts = data?.imageQueueCounts ?? {};
  const queueModeTone = data?.driver === "redis" ? "green" : "amber";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
            <ServerCog className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Redis Worker 运维</CardTitle>
            <p className="mt-0.5 text-xs font-medium text-muted">查看任务队列是否积压、worker 是否在线，以及失败任务是否需要人工介入。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={queueModeTone}>{data?.driver ?? "-"}</Badge>
          <Badge tone={failed > 0 ? "red" : "green"}>失败 {failed}</Badge>
          <Badge tone={waiting + active + delayed > 0 ? "amber" : "green"}>待处理 {waiting + active + delayed}</Badge>
          <Button variant="secondary" size="sm" onClick={() => void loadHealth()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        {loading ? <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">正在读取 worker 状态...</div> : null}
        {!loading && data && data.driver !== "redis" ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            当前未启用 Redis 队列，导入与导出任务将按同步模式执行，不适合 30 人并发场景。
          </div>
        ) : null}

        {data?.queueAvailable === false ? <p role="status" className="text-xs text-red-700">Redis 队列不可用，任务数量暂不可确认；下方显示数据库中最近的 Worker 心跳。</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {data?.registeredWorkers?.map(worker => <div key={worker.id} className="rounded-md border border-border p-3 text-xs">
            <div className="flex items-center justify-between gap-2"><strong>{worker.label}</strong><Badge tone={worker.online ? "green" : "red"}>{worker.online ? "心跳在线" : "离线 / 未启动"}</Badge></div>
            <p className="mt-2 text-muted">队列连接：{worker.queueReady === null ? "未知" : worker.queueReady ? "已连接" : "不可用"} · 在线实例 {worker.instances}</p>
            <p className={worker.connectionMatches === false ? "mt-1 text-red-700" : "mt-1 text-muted"}>与网页连接目标：{worker.connectionMatches === true ? "一致" : worker.connectionMatches === false ? "不一致，请检查配置与认证密钥" : "尚未确认"}</p>
            <p className="mt-1 text-muted">版本：{worker.version ?? "未知"}{worker.online && !worker.versionMatches ? `（${worker.mismatchedInstances ?? 1} 个实例与网页版本不一致）` : ""}</p>
            <p className="mt-1 text-muted">最近心跳：{worker.lastSeenAt ? formatDate(worker.lastSeenAt) : "尚无记录"}</p>
          </div>)}
        </div>

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
          <div className="rounded-md border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-bold text-foreground">图片放大 Worker</p>
              <Badge tone={Number(imageCounts.failed ?? 0) > 0 ? "red" : "green"}>失败 {Number(imageCounts.failed ?? 0)}</Badge>
            </div>
            <div className="p-2.5">
              <p className="text-xs font-medium text-muted">队列：待处理 {Number(imageCounts.waiting ?? 0)} · 处理中 {Number(imageCounts.active ?? 0)}</p>
              {data?.imageWorkers?.map((worker) => (
                <div key={worker.id} className="mt-2 rounded-md border border-border bg-surface-muted px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-foreground">{worker.workerName}</p>
                    <Badge tone={worker.online ? "green" : "red"}>{worker.online ? "online" : worker.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted">并发 {worker.concurrency} · {formatDate(worker.lastSeenAt)}</p>
                </div>
              ))}
              {!data?.imageWorkers?.length ? <p className="mt-3 text-xs font-medium text-amber-700">图片 Worker 尚未上报心跳。</p> : null}
            </div>
          </div>
          <div className="rounded-md border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-bold text-foreground">商品域一致性</p>
              <Badge tone={(data?.productHealth?.projections.failed ?? 0) > 0 ? "red" : "green"}>
                投影失败 {data?.productHealth?.projections.failed ?? 0}
              </Badge>
            </div>
            {data?.productHealth ? (
              <div className="grid grid-cols-2 gap-2 p-2.5 text-xs">
                <div className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
                  <p className="font-semibold text-muted">Outbox 待处理</p>
                  <p className="mt-1 text-lg font-black metric-tabular text-foreground">
                    {(data.productHealth.outbox.queued + data.productHealth.outbox.running).toLocaleString("zh-CN")}
                  </p>
                  <p className="mt-1 text-muted">
                    运行中 {data.productHealth.outbox.running} · 失败 {data.productHealth.outbox.failed}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
                  <p className="font-semibold text-muted">异常重试</p>
                  <p className="mt-1 text-lg font-black metric-tabular text-foreground">
                    {(data.productHealth.outbox.staleRunning + data.productHealth.projections.staleFailures).toLocaleString("zh-CN")}
                  </p>
                  <p className="mt-1 text-muted">
                    超时 Outbox · 投影失败
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
                  <p className="font-semibold text-muted">投影处理中</p>
                  <p className="mt-1 text-lg font-black metric-tabular text-foreground">
                    {(data.productHealth.projections.pending + data.productHealth.projections.processing).toLocaleString("zh-CN")}
                  </p>
                  <p className="mt-1 text-muted">
                    待开始 {data.productHealth.projections.pending} · 处理中 {data.productHealth.projections.processing}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
                  <p className="font-semibold text-muted">读模型漂移</p>
                  <p className="mt-1 text-lg font-black metric-tabular text-foreground">
                    {(
                      data.productHealth.consistency.missingSummary
                      + data.productHealth.consistency.staleSummary
                      + data.productHealth.consistency.missingText
                      + data.productHealth.consistency.staleText
                      + data.productHealth.consistency.missingProjectionStates
                    ).toLocaleString("zh-CN")}
                  </p>
                  <p className="mt-1 text-muted">
                    商品记录 {data.productHealth.consistency.productRecords.toLocaleString("zh-CN")} · 缺少投影状态 {data.productHealth.consistency.missingProjectionStates}
                  </p>
                </div>
              </div>
            ) : (
              <p className="p-3 text-xs font-medium text-muted">数据库未启用，暂无商品域健康数据。</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
