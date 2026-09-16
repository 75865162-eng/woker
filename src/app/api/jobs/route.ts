import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getImportJobQueue, importJobQueueName } from "@/lib/queue/redis-queue";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

const workerHeartbeatWindowMs = 90_000;
const stuckJobThresholdMs = 120_000;

function getRuntimePayload(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const runtime = (payload as Record<string, unknown>)._runtime;
  return runtime && typeof runtime === "object" && !Array.isArray(runtime) ? runtime as Record<string, unknown> : null;
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("workspace", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const status = url.searchParams.get("status")?.trim();
    const search = url.searchParams.get("search")?.trim();
    const where: Prisma.ImportJobWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(status ? { status: status as Prisma.EnumImportJobStatusFilter["equals"] } : {}),
      ...(search
        ? {
            file: {
              originalName: { contains: search, mode: "insensitive" },
            },
          }
        : {}),
    };
    const [total, jobs, heartbeats] = await Promise.all([
      prisma.importJob.count({ where }),
      prisma.importJob.findMany({
        where,
        include: { file: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      process.env.DATABASE_URL
        ? prisma.workerHeartbeat.findMany({
            where: { queueName: importJobQueueName },
            orderBy: { lastSeenAt: "desc" },
            take: 20,
          })
        : [],
    ]);

    const driver = process.env.QUEUE_DRIVER ?? "inline";
    let waitingQueueJobs: Array<{ id?: string; data?: { jobId?: string } }> = [];
    let activeQueueJobs: Array<{ id?: string; data?: { jobId?: string } }> = [];
    let delayedQueueJobs: Array<{ id?: string; data?: { jobId?: string } }> = [];
    let queueError: string | null = null;

    if (driver === "redis") {
      try {
        const queue = getImportJobQueue();
        [waitingQueueJobs, activeQueueJobs, delayedQueueJobs] = await Promise.all([
          queue.getJobs(["waiting"], 0, 499, true) as Promise<Array<{ id?: string; data?: { jobId?: string } }>>,
          queue.getJobs(["active"], 0, 499, true) as Promise<Array<{ id?: string; data?: { jobId?: string } }>>,
          queue.getJobs(["delayed"], 0, 499, true) as Promise<Array<{ id?: string; data?: { jobId?: string } }>>,
        ]);
      } catch (error) {
        queueError = error instanceof Error ? error.message : "Redis 队列状态读取失败";
      }
    }

    const onlineWorkers = heartbeats.filter(
      (heartbeat) => heartbeat.status === "online" && heartbeat.lastSeenAt.getTime() > Date.now() - workerHeartbeatWindowMs,
    );
    const queuedAheadByJobId = new Map<string, number>();
    waitingQueueJobs.forEach((queueJob, index) => {
      const jobId = queueJob.data?.jobId;
      if (jobId) queuedAheadByJobId.set(jobId, index);
    });
    const activeJobIds = new Set(activeQueueJobs.map((queueJob) => queueJob.data?.jobId).filter((jobId): jobId is string => Boolean(jobId)));
    const delayedJobIds = new Set(delayedQueueJobs.map((queueJob) => queueJob.data?.jobId).filter((jobId): jobId is string => Boolean(jobId)));

    const jobsWithDiagnostics = jobs.map((job) => {
      const runtime = getRuntimePayload(job.payload);
      const isQueued = job.status === "queued";
      const isRunning = job.status === "running";
      const ageMs = Date.now() - (isQueued ? job.createdAt.getTime() : job.updatedAt.getTime());
      const queuePosition = queuedAheadByJobId.get(job.id);
      const queueMessageExists = queuePosition !== undefined || activeJobIds.has(job.id) || delayedJobIds.has(job.id);
      const workerHasTask = activeJobIds.has(job.id);
      const workerOnline = onlineWorkers.length > 0;
      const suspectedStuck =
        job.status === "queued"
          ? ageMs >= stuckJobThresholdMs && (!workerOnline || queueError !== null || !queueMessageExists)
          : job.status === "running" && ageMs >= stuckJobThresholdMs && (!workerOnline || !activeJobIds.has(job.id));

      return {
        ...job,
        diagnostics: {
          queueName: importJobQueueName,
          queuePosition: queuePosition === undefined ? null : queuePosition + 1,
          aheadCount: queuePosition ?? null,
          queueMessageExists,
          queueState: activeJobIds.has(job.id) ? "active" : delayedJobIds.has(job.id) ? "delayed" : queuePosition !== undefined ? "waiting" : "missing",
          workerOnline,
          workerCount: onlineWorkers.length,
          workerHasTask,
          startedAt: isRunning ? job.updatedAt.toISOString() : typeof runtime?.startedAt === "string" ? runtime.startedAt : null,
          processedCount: typeof runtime?.processedCount === "number" ? runtime.processedCount : null,
          totalCount: typeof runtime?.totalCount === "number" ? runtime.totalCount : null,
          phase: typeof runtime?.phase === "string" ? runtime.phase : null,
          lastUpdatedAt: job.updatedAt.toISOString(),
          ageMs,
          suspectedStuck,
          queueError,
        },
      };
    });

    return NextResponse.json({
      jobs: jobsWithDiagnostics,
      worker: {
        online: onlineWorkers.length > 0,
        count: onlineWorkers.length,
        queueName: importJobQueueName,
        queueError,
      },
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load jobs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
