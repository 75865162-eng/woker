import { Queue } from "bullmq";

export const importJobQueueName = "import-jobs";
export const imageUpscaleJobQueueName = "image-upscale-jobs";
export const productOutboxQueueName = "product-outbox-jobs";

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
