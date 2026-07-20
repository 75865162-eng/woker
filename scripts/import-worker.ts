import "dotenv/config";
import { Worker } from "bullmq";
import { processImportJob } from "@/lib/jobs/processor";
import { createRedisConnectionOptions, importJobQueueName } from "@/lib/queue/redis-queue";

const worker = new Worker<{ jobId: string }>(
  importJobQueueName,
  async (job) => {
    await processImportJob(job.data.jobId);
  },
  {
    connection: createRedisConnectionOptions(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  },
);

worker.on("completed", (job) => {
  console.log(`[worker] completed ${job.data.jobId}`);
});

worker.on("failed", (job, error) => {
  console.error(`[worker] failed ${job?.data.jobId ?? "unknown"}:`, error);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

console.log(`[worker] listening on ${importJobQueueName}`);
