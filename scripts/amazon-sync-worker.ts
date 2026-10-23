import "dotenv/config";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { enqueueAmazonSyncRun } from "@/lib/queue";
import { createRedisConnectionOptions, amazonSyncQueueName } from "@/lib/queue/redis-queue";
import { prisma } from "@/lib/db/prisma";
import { enqueueDueAmazonSchedules } from "@/lib/operations/schedules";
import { enqueuePendingAmazonSyncRuns, processAmazonSyncRun, recoverStaleAmazonSyncRuns } from "@/lib/operations/sync-processor";

const configuredConcurrency = Number(process.env.AMAZON_SYNC_WORKER_CONCURRENCY ?? 1);
const concurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(Math.floor(configuredConcurrency), 2)) : 1;
const workerName = process.env.AMAZON_SYNC_WORKER_NAME?.trim() || `${amazonSyncQueueName}-${process.pid}`;
const workerId = process.env.AMAZON_SYNC_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const worker = new Worker<{ runId: string }>(
  amazonSyncQueueName,
  async (job) => {
    await processAmazonSyncRun(job.data.runId, { isFinalAttempt: job.attemptsMade >= (job.opts.attempts ?? 1) - 1 });
  },
  { connection: createRedisConnectionOptions(), concurrency },
);

let recovering = false;
async function recoverQueuedRuns() {
  if (recovering) return;
  recovering = true;
  try {
  await enqueueDueAmazonSchedules();
  await recoverStaleAmazonSyncRuns();
  const runIds = await enqueuePendingAmazonSyncRuns();
  await Promise.all(runIds.map((runId) => enqueueAmazonSyncRun(runId)));
  } finally { recovering = false; }
}

async function writeHeartbeat(status: "online" | "stopping" = "online") {
  if (!process.env.DATABASE_URL) return;
  await prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: {
      id: workerId,
      workerName,
      queueName: amazonSyncQueueName,
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: { pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue,
    },
    update: {
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: { pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue,
    },
  });
}

void recoverQueuedRuns().catch((error) => console.error("[amazon-sync-worker] recovery failed:", error));
const recoveryTimer = setInterval(() => {
  void recoverQueuedRuns().catch((error) => console.error("[amazon-sync-worker] recovery failed:", error));
}, 30_000);
void writeHeartbeat().catch((error) => console.error("[amazon-sync-worker] heartbeat failed:", error));
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => console.error("[amazon-sync-worker] heartbeat failed:", error));
}, 30_000);

worker.on("completed", (job) => console.log(`[amazon-sync-worker] completed ${job.data.runId}`));
worker.on("failed", (job, error) => console.error(`[amazon-sync-worker] failed ${job?.data.runId ?? "unknown"}:`, error));

async function shutdown() {
  clearInterval(recoveryTimer);
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`[amazon-sync-worker] listening on ${amazonSyncQueueName}`);
