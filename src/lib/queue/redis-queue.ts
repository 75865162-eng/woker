import { Queue } from "bullmq";

export const importJobQueueName = "import-jobs";

export function createRedisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

let importJobQueue: Queue<{ jobId: string }> | undefined;

export function getImportJobQueue() {
  importJobQueue ??= new Queue<{ jobId: string }>(importJobQueueName, {
    connection: createRedisConnectionOptions(),
  });

  return importJobQueue;
}
