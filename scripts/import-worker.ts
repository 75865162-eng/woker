import "dotenv/config";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { processImportJob } from "@/lib/jobs/processor";
import { prisma } from "@/lib/db/prisma";
import { createRedisConnectionOptions, importJobQueueName } from "@/lib/queue/redis-queue";

const workerName = process.env.WORKER_NAME?.trim() || `${importJobQueueName}-${process.pid}`;
const workerId = process.env.WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);

const worker = new Worker<{ jobId: string }>(
  importJobQueueName,
  async (job) => {
    await processImportJob(job.data.jobId);
  },
  {
    connection: createRedisConnectionOptions(),
    concurrency,
  },
);

async function writeHeartbeat(status: "online" | "stopping" = "online") {
  if (!process.env.DATABASE_URL) return;

  await prisma.workerHeartbeat.upsert({
    where: {
      id: workerId,
    },
    create: {
      id: workerId,
      workerName,
      queueName: importJobQueueName,
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: {
        pid: process.pid,
        hostname: process.env.HOSTNAME,
      } satisfies Prisma.InputJsonValue,
    },
    update: {
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: {
        pid: process.pid,
        hostname: process.env.HOSTNAME,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

void writeHeartbeat();
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => {
    console.error("[worker] heartbeat failed:", error);
  });
}, 30_000);

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.data.jobId}`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.data.jobId ?? "unknown"}:`, error);
});

process.on("SIGINT", async () => {
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(heartbeatTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  process.exit(0);
});

console.log(`[worker] listening on ${importJobQueueName}`);
