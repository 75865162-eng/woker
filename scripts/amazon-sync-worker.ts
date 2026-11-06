import "./runtime/worker-bootstrap.mjs";
import { createHeartbeatWriter } from "@/lib/runtime/heartbeat-writer";
import { observeWorker, runtimeHeartbeatMetadata } from "@/lib/runtime/worker-diagnostics";
import { amazonWorkerPolicy, workerAllows } from "@/lib/amazon-sync/worker-policy";
import { processSalesExport } from "@/lib/amazon-sync/exports";
import { enabledSyncScopes, tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { createRedisConnectionOptions, getAmazonSyncQueueName, type AmazonSyncQueueJob } from "@/lib/queue/redis-queue";
import { prisma } from "@/lib/db/prisma";
import { refreshDueReplenishmentPlans } from "@/lib/operations/replenishment-service";
import { processAmazonAdsSyncTask } from "@/lib/amazon-ads/sync-processor";
import { tickAmazonAds } from "@/lib/amazon-ads/sync-scheduler";
import { rejectUnverifiedReportingV1Dispatch } from "@/lib/amazon-ads/report-dispatch";

const policy = amazonWorkerPolicy();
const amazonSyncQueueName = getAmazonSyncQueueName();
const configuredConcurrency = Number(process.env.AMAZON_SYNC_WORKER_CONCURRENCY ?? 1);
const concurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(Math.floor(configuredConcurrency), 2)) : 1;
const workerName = process.env.AMAZON_SYNC_WORKER_NAME?.trim() || `${amazonSyncQueueName}-${process.pid}`;
const workerId = process.env.AMAZON_SYNC_WORKER_ID?.trim() || `${workerName}-${process.pid}`;
const worker = new Worker<AmazonSyncQueueJob>(
  amazonSyncQueueName,
  async (job) => {
    if (job.name === "process-amazon-ads-report-task") rejectUnverifiedReportingV1Dispatch();
    if (job.name === "export-amazon-sales" && job.data.exportId && Number.isInteger(job.data.fence)) { if (workerAllows(policy, "export", job.data.exportId)) await processSalesExport(job.data.exportId, job.data.fence!); return; }
    if (job.name === "process-amazon-ads-sync-task" && job.data.adsTaskId && Number.isInteger(job.data.adsDispatchVersion)) { if (workerAllows(policy, "task", job.data.adsTaskId)) await processAmazonAdsSyncTask(job.data.adsTaskId, job.data.adsDispatchVersion!); return; }
    if (!Number.isInteger(job.data.dispatchVersion)) throw new Error("Legacy/unversioned jobs are rejected.");
    if (workerAllows(policy, "task", job.data.runId)) await processSyncCenterTask(job.data.runId, job.data.dispatchVersion!);
  },
  { connection: createRedisConnectionOptions(), concurrency },
);

let recovering = false;
async function recoverQueuedRuns() {
  if (recovering) return;
  recovering = true;
  try {
    await tickSyncCenter(new Date(), policy.mode === "approved-only" ? { taskIds: policy.taskIds!, exportIds: policy.exportIds! } : undefined);
    if (policy.mode === "standard") await tickAmazonAds();
    if (policy.runReplenishment) await refreshDueReplenishmentPlans();
  } finally { recovering = false; }
}

observeWorker(worker, "amazon-sync-worker");

async function persistHeartbeat(status: "online" | "stopping") {
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
      metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME, mode: policy.mode } satisfies Prisma.InputJsonValue,
    },
    update: {
      queueName: amazonSyncQueueName,
      status,
      concurrency,
      lastSeenAt: new Date(),
      metadata: { ...runtimeHeartbeatMetadata(), pid: process.pid, hostname: process.env.HOSTNAME, mode: policy.mode } satisfies Prisma.InputJsonValue,
    },
  });
}

const writeHeartbeat = createHeartbeatWriter(persistHeartbeat);

void recoverQueuedRuns().catch(() => console.error("[amazon-sync-worker] recovery failed; retrying next tick"));
const recoveryTimer = setInterval(() => {
  void recoverQueuedRuns().catch(() => console.error("[amazon-sync-worker] recovery failed; retrying next tick"));
}, 30_000);
void writeHeartbeat().catch(() => console.error("[amazon-sync-worker] heartbeat failed"));
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch(() => console.error("[amazon-sync-worker] heartbeat failed"));
}, 30_000);

worker.on("completed", (job) => console.log(`[amazon-sync-worker] completed ${job.data.runId}`));
// BullMQ reconnects after Redis loss; keep error details (URLs/credentials) out of logs.
worker.on("failed", (job) => console.error(`[amazon-sync-worker] failed ${job?.data.runId ?? "unknown"}; inspect persisted task state`));

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
if (!enabledSyncScopes().length) console.warn("[amazon-sync-worker] SP-API automatic sync disabled: configure exact AMAZON_SYNC_CENTER_SCOPES organization/workspace pairs");
