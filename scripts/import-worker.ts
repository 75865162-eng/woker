import "./runtime/worker-bootstrap.mjs";
import { createHeartbeatWriter } from "@/lib/runtime/heartbeat-writer";
import { recoverExpiredExecutions } from "@/lib/runtime/job-execution";
import { observeWorker, runtimeHeartbeatMetadata } from "@/lib/runtime/worker-diagnostics";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { processImportJob } from "@/lib/jobs/processor";
import { enqueueImportJob, enqueueProductOutboxEvent } from "@/lib/queue";
import { enqueuePendingProductOutboxEvents, markExpiredProductAttachmentsOrphaned, processProductOutboxEvent, recoverStaleProductOutboxEvents, scanOverdueProductWorkflowNotifications } from "@/lib/products/product-outbox";
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

async function enqueuePendingImportJobs(limit = 50) {
  await recoverExpiredExecutions("import", limit);
  const jobs = await prisma.importJob.findMany({
    where: {
      status: "queued",
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });

  await Promise.all(jobs.map((job) => enqueueImportJob(job.id)));
}

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

observeWorker(productOutboxWorker, "product-outbox-worker");
observeWorker(worker, "import-worker");

async function persistHeartbeat(status: "online" | "stopping") {
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
        ...runtimeHeartbeatMetadata(), pid: process.pid,
        hostname: process.env.HOSTNAME,
      } satisfies Prisma.InputJsonValue,
    },
    update: {
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: {
        ...runtimeHeartbeatMetadata(), pid: process.pid,
        hostname: process.env.HOSTNAME,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

const writeHeartbeat = createHeartbeatWriter(persistHeartbeat);

void writeHeartbeat().catch(() => console.error("[worker] heartbeat unavailable; retrying"));
void enqueuePendingImportJobs().catch(() => {
  console.error("[worker] queued import job recovery failed:");
});
void enqueuePendingOutboxEvents().catch(() => {
  console.error("[worker] product outbox recovery failed:");
});
void markExpiredProductAttachmentsOrphaned().catch(() => {
  console.error("[worker] product attachment cleanup failed:");
});
void scanOverdueProductWorkflowNotifications().catch(() => console.error("[worker] overdue workflow notification scan failed:"));
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch(() => {
    console.error("[worker] heartbeat failed:");
  });
}, 30_000);
const outboxRecoveryTimer = setInterval(() => {
  void enqueuePendingOutboxEvents().catch(() => {
    console.error("[worker] product outbox recovery failed:");
  });
}, 15_000);
const importJobRecoveryTimer = setInterval(() => {
  void enqueuePendingImportJobs().catch(() => {
    console.error("[worker] queued import job recovery failed:");
  });
}, 15_000);
const attachmentCleanupTimer = setInterval(() => {
  void markExpiredProductAttachmentsOrphaned().catch(() => {
    console.error("[worker] product attachment cleanup failed:");
  });
}, 5 * 60_000);
const overdueWorkflowTimer = setInterval(() => {
  void scanOverdueProductWorkflowNotifications().catch(() => console.error("[worker] overdue workflow notification scan failed:"));
}, 60_000);

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.data.jobId}`);
});

worker.on("failed", (job) => {
  console.error(`[worker] failed ${job?.data.jobId ?? "unknown"}; inspect persisted task state`);
});

process.on("SIGINT", async () => {
  clearInterval(heartbeatTimer);
  clearInterval(importJobRecoveryTimer);
  clearInterval(outboxRecoveryTimer);
  clearInterval(attachmentCleanupTimer);
  clearInterval(overdueWorkflowTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await productOutboxWorker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  clearInterval(heartbeatTimer);
  clearInterval(importJobRecoveryTimer);
  clearInterval(outboxRecoveryTimer);
  clearInterval(attachmentCleanupTimer);
  clearInterval(overdueWorkflowTimer);
  await writeHeartbeat("stopping").catch(() => undefined);
  await worker.close();
  await productOutboxWorker.close();
  process.exit(0);
});

console.log(`[worker] listening on ${importJobQueueName}`);
