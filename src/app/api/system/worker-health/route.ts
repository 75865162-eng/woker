import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { getImageUpscaleJobQueue, getImportJobQueue, imageUpscaleJobQueueName, importJobQueueName } from "@/lib/queue/redis-queue";
import { getProductOutboxHealth } from "@/lib/products/product-outbox";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

import registry from "@/lib/runtime/worker-registry.json";
import { queueHealth } from "@/lib/runtime/queue-health";
import { registeredWorkerHealth } from "@/lib/runtime/worker-health";
import { publicHeartbeatMetadata } from "@/lib/runtime/connection-identity";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;
    const workspaceId = workspaceScopeFromRequest(request).workspaceId;

    const driver = process.env.QUEUE_DRIVER ?? "inline";
    const [importQueueHealth, imageQueueHealth] = await Promise.all([
      queueHealth(async () => driver === "redis" ? await getImportJobQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused") : {}),
      queueHealth(async () => driver === "redis" ? await getImageUpscaleJobQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused") : {}),
    ]);
    const heartbeatCutoff = new Date(Date.now() - 90_000);
    const [allHeartbeats, recentImageJobs, recentJobs, productHealth] = await Promise.all([
      process.env.DATABASE_URL
        ? Promise.all(registry.map(item => prisma.workerHeartbeat.findMany({
            where: { queueName: item.heartbeatQueue }, orderBy: { lastSeenAt: "desc" }, take: 20,
          }))).then(groups => groups.flat())
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
      process.env.DATABASE_URL
        ? getProductOutboxHealth({
            organizationId: user.organizationId,
            workspaceId,
          })
        : null,
    ]);

    const heartbeats = allHeartbeats.filter(h => h.queueName === importJobQueueName);
    const imageWorkers = allHeartbeats.filter(h => h.queueName === imageUpscaleJobQueueName);
    return NextResponse.json({
      registeredWorkers: registeredWorkerHealth(allHeartbeats),
      driver,
      queueName: importJobQueueName,
      queueCounts: importQueueHealth.counts,
      imageQueueCounts: imageQueueHealth.counts,
      queueAvailable: importQueueHealth.available && imageQueueHealth.available,
      workers: heartbeats.map((heartbeat) => ({
        ...heartbeat,
        metadata: publicHeartbeatMetadata(heartbeat.metadata),
        online: heartbeat.status === "online" && heartbeat.lastSeenAt > heartbeatCutoff,
      })),
      imageWorkers: imageWorkers.map((heartbeat) => ({
        ...heartbeat,
        metadata: publicHeartbeatMetadata(heartbeat.metadata),
        online: heartbeat.status === "online" && heartbeat.lastSeenAt > heartbeatCutoff,
      })),
      recentJobs,
      recentImageJobs,
      productHealth,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load worker health.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
