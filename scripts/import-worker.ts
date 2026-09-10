import "dotenv/config";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { processImportJob } from "@/lib/jobs/processor";
import { enqueueProductOutboxEvent } from "@/lib/queue";
import { enqueuePendingProductOutboxEvents, markExpiredProductAttachmentsOrphaned, processProductOutboxEvent, recoverStaleProductOutboxEvents } from "@/lib/products/product-outbox";
import { prisma } from "@/lib/db/prisma";
import { createRedisConnectionOptions, importJobQueueName, productOutboxQueueName } from "@/lib/queue/redis-queue";

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

const productOutboxWorker = new Worker<{ eventId: string }>(
  productOutboxQueueName,
  async (job) => {
    await processProductOutboxEvent(job.data.eventId);
  },
  {
    connection: createRedisConnectionOptions(),
    concurrency: Math.max(1, Number(process.env.PRODUCT_OUTBOX_WORKER_CONCURRENCY ?? 2)),
  },
);

async function enqueuePendingOutboxEvents() {
  if (process.env.QUEUE_DRIVER !== "redis") return;
  await recoverStaleProductOutboxEvents();
  const events = await enqueuePendingProductOutboxEvents();
  await Promise.all(events.map((event) => enqueueProductOutboxEvent(event.id)));
}

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
void enqueuePendingOutboxEvents().catch((error) => {
  console.error("[worker] product outbox recovery failed:", error);
});
void markExpiredProductAttachmentsOrphaned().catch((error) => {
  console.error("[worker] product attachment cleanup failed:", error);
});
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => {
    console.error("[worker] heartbeat failed:", error);
  });
}, 30_000);
const outboxRecoveryTimer = setInterval(() => {
  void enqueuePendingOutboxEvents().catch((error) => {
    console.error("[worker] product outbox recovery failed:", error);
  });
}, 15_000);
const attachmentCleanupTimer = setInterval(() => {
  void markExpiredProductAttachmentsOrphaned().catch((error) => {
    console.error("[worker] product attachment cleanup failed:", error);
  });
}, 5 * 60_000);

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.data.jobId}`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.data.jobId ?? "unknown"}:`, error);
});

process.on("SIGINT", async () => {
  clearInterval(heartbeatTimer);
  clearInterval(outboxRecoveryTimer);
  clearInterval(attachmentCleanupTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await productOutboxWorker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(heartbeatTimer);
  clearInterval(outboxRecoveryTimer);
  clearInterval(attachmentCleanupTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await productOutboxWorker.close();
  process.exit(0);
});

console.log(`[worker] listening on ${importJobQueueName}`);
