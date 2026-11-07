import "./runtime/worker-bootstrap.mjs";
import { createHeartbeatWriter } from "@/lib/runtime/heartbeat-writer";
import { recoverExpiredExecutions } from "@/lib/runtime/job-execution";
import { observeWorker, runtimeHeartbeatMetadata } from "@/lib/runtime/worker-diagnostics";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { recoverQueuedJobs } from "@/lib/runtime/queued-recovery";
import { enqueueImageUpscaleJob } from "@/lib/queue";
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

observeWorker(worker, "image-upscale-worker");

async function persistHeartbeat(status: "online" | "stopping") {
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
      metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue,
    },
    update: {
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME } satisfies Prisma.InputJsonValue,
    },
  });
}

const writeHeartbeat = createHeartbeatWriter(persistHeartbeat);

void writeHeartbeat().catch(() => console.error("[worker] heartbeat unavailable; retrying"));
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch(() => console.error("[image-upscale-worker] heartbeat failed:"));
}, 30_000);

worker.on("completed", (job) => console.log(`[image-upscale-worker] completed ${job.data.jobId}`));
worker.on("failed", (job) => console.error(`[image-upscale-worker] failed ${job?.data.jobId ?? "unknown"}; inspect persisted task state`));

let recovering = false;
async function recoverPendingJobs() {
  if (recovering) return;
  recovering = true;
  try {
    await recoverExpiredExecutions("image-upscale");
    await recoverQueuedJobs(
      () => prisma.imageUpscaleJob.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true } }),
      enqueueImageUpscaleJob,
    );
  } finally { recovering = false; }
}
void recoverPendingJobs().catch(() => console.error("[image-upscale-worker] recovery unavailable; retrying"));
const recoveryTimer = setInterval(() => void recoverPendingJobs().catch(() => console.error("[image-upscale-worker] recovery unavailable; retrying")), 30_000);

async function shutdown() {
  clearInterval(recoveryTimer);
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`[image-upscale-worker] listening on ${imageUpscaleJobQueueName}, concurrency=${concurrency}`);
