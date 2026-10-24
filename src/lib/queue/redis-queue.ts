import { Queue } from "bullmq";

export const importJobQueueName = "import-jobs";
export const imageUpscaleJobQueueName = "image-upscale-jobs";
export const productOutboxQueueName = "product-outbox-jobs";
export const amazonSyncQueueName = "amazon-sync-jobs";
export const sellfoxSyncQueueName = "sellfox-sync-jobs";

export function createRedisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

let importJobQueue: Queue<{ jobId: string }> | undefined;
let imageUpscaleJobQueue: Queue<{ jobId: string }> | undefined;
let productOutboxQueue: Queue<{ eventId: string }> | undefined;
let amazonSyncQueue: Queue<{ runId: string }> | undefined;
let sellfoxSyncQueue: Queue<{ runId: string }> | undefined;

export function getImportJobQueue() {
  importJobQueue ??= new Queue<{ jobId: string }>(importJobQueueName, {
    connection: createRedisConnectionOptions(),
  });

  return importJobQueue;
}

export function getImageUpscaleJobQueue() {
  imageUpscaleJobQueue ??= new Queue<{ jobId: string }>(imageUpscaleJobQueueName, {
    connection: createRedisConnectionOptions(),
  });

  return imageUpscaleJobQueue;
}

export function getProductOutboxQueue() {
  productOutboxQueue ??= new Queue<{ eventId: string }>(productOutboxQueueName, {
    connection: createRedisConnectionOptions(),
  });

  return productOutboxQueue;
}

export function getAmazonSyncQueue() {
  amazonSyncQueue ??= new Queue<{ runId: string }>(amazonSyncQueueName, {
    connection: createRedisConnectionOptions(),
  });
  return amazonSyncQueue;
}

export function getSellfoxSyncQueue() {
  sellfoxSyncQueue ??= new Queue<{ runId: string }>(sellfoxSyncQueueName, {
    connection: createRedisConnectionOptions(),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: 200 },
  });
  return sellfoxSyncQueue;
}
