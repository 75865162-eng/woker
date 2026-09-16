import "dotenv/config";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { processImageUpscaleJob } from "@/lib/image-upscale/processor";
import { createRedisConnectionOptions, imageUpscaleJobQueueName } from "@/lib/queue/redis-queue";

const workerName = process.env.IMAGE_UPSCALE_WORKER_NAME?.trim() || `${imageUpscaleJobQueueName}-${process.pid}`;
const workerId = process.env.IMAGE_UPSCALE_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const concurrency = Math.max(1, Number(process.env.IMAGE_UPSCALE_WORKER_CONCURRENCY ?? 1));

const worker = new Worker<{ jobId: string }>(
  imageUpscaleJobQueueName,
  async (job) => processImageUpscaleJob(job.data.jobId),
  { connection: createRedisConnectionOptions(), concurrency },
);

async function writeHeartbeat(status: "online" | "stopping" = "online") {
  if (!process.env.DATABASE_URL) return;
  await prisma.workerHeartbeat.upsert({
    where: { id: workerId },
    create: {
      id: workerId,
      workerName,
      queueName: imageUpscaleJobQueueName,
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

void writeHeartbeat();
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => console.error("[image-upscale-worker] heartbeat failed:", error));
}, 30_000);

worker.on("completed", (job) => console.log(`[image-upscale-worker] completed ${job.data.jobId}`));
worker.on("failed", (job, error) => console.error(`[image-upscale-worker] failed ${job?.data.jobId ?? "unknown"}:`, error));

async function shutdown() {
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`[image-upscale-worker] listening on ${imageUpscaleJobQueueName}, concurrency=${concurrency}`);
