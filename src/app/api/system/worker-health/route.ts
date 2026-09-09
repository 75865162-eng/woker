import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getImageUpscaleJobQueue, getImportJobQueue, imageUpscaleJobQueueName, importJobQueueName } from "@/lib/queue/redis-queue";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const driver = process.env.QUEUE_DRIVER ?? "inline";
    const queueCounts =
      driver === "redis"
        ? await getImportJobQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused")
        : { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
    const imageQueueCounts =
      driver === "redis"
        ? await getImageUpscaleJobQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused")
        : { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
    const heartbeatCutoff = new Date(Date.now() - 90_000);
    const [heartbeats, imageWorkers, recentImageJobs, recentJobs] = await Promise.all([
      process.env.DATABASE_URL
        ? prisma.workerHeartbeat.findMany({
            where: {
              queueName: importJobQueueName,
            },
            orderBy: {
              lastSeenAt: "desc",
            },
            take: 20,
          })
        : [],
      process.env.DATABASE_URL
        ? prisma.workerHeartbeat.findMany({
            where: { queueName: imageUpscaleJobQueueName },
            orderBy: { lastSeenAt: "desc" },
            take: 20,
          })
        : [],
      process.env.DATABASE_URL
        ? prisma.imageUpscaleJob.findMany({
            where: { organizationId: user.organizationId, OR: [{ status: "running" }, { status: "failed" }] },
            orderBy: { updatedAt: "desc" },
            take: 20,
          })
        : [],
      process.env.DATABASE_URL
        ? prisma.importJob.findMany({
            where: {
              organizationId: user.organizationId,
              OR: [{ status: "running" }, { status: "failed" }],
            },
            include: {
              file: true,
            },
            orderBy: {
              updatedAt: "desc",
            },
            take: 20,
          })
        : [],
    ]);

    return NextResponse.json({
      driver,
      queueName: importJobQueueName,
      queueCounts,
      imageQueueCounts,
      workers: heartbeats.map((heartbeat) => ({
        ...heartbeat,
        online: heartbeat.status === "online" && heartbeat.lastSeenAt > heartbeatCutoff,
      })),
      imageWorkers: imageWorkers.map((heartbeat) => ({
        ...heartbeat,
        online: heartbeat.status === "online" && heartbeat.lastSeenAt > heartbeatCutoff,
      })),
      recentJobs,
      recentImageJobs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load worker health.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
