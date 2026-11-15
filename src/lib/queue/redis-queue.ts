import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { amazonWorkerPolicy } from "@/lib/amazon-sync/worker-policy";

export const importJobQueueName = "import-jobs";
export const imageUpscaleJobQueueName = "image-upscale-jobs";
export const productOutboxQueueName = "product-outbox-jobs";
export const wmsEventQueueName = "wms-domain-events";
export const amazonSyncQueueName = "amazon-data-center-jobs";
export function getAmazonSyncQueueName() {
  const policy = amazonWorkerPolicy();
  if (policy.mode === "standard") return amazonSyncQueueName;
  const suffix = createHash("sha256").update(JSON.stringify([[...policy.taskIds!].sort(), [...policy.exportIds!].sort()])).digest("hex").slice(0, 16);
  return `${amazonSyncQueueName}-controlled-${suffix}`;
}
export const sellfoxSyncQueueName = "sellfox-sync-jobs";

export function createRedisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

// Producers fail promptly during outages; the database retains queued intent.
// Blocking Worker connections keep their separate reconnect policy above.
export function createRedisProducerConnectionOptions() {
  return { ...createRedisConnectionOptions(), maxRetriesPerRequest: 1, enableOfflineQueue: false };
}

let importJobQueue: Queue<{ jobId: string }> | undefined;
let imageUpscaleJobQueue: Queue<{ jobId: string }> | undefined;
let productOutboxQueue: Queue<{ eventId: string }> | undefined;
let wmsEventQueue: Queue<{ deliveryId: string }> | undefined;
export type AmazonSyncQueueJob = { runId: string; dispatchVersion?: number; exportId?: string; fence?: number; adsTaskId?: string; adsDispatchVersion?: number; adsReportTaskId?: string; adsReportDispatchVersion?: number };
let amazonSyncQueue: Queue<AmazonSyncQueueJob> | undefined;
let sellfoxSyncQueue: Queue<{ runId: string }> | undefined;

export function getImportJobQueue() {
  importJobQueue ??= new Queue<{ jobId: string }>(importJobQueueName, {
    connection: createRedisProducerConnectionOptions(),
  });

  return importJobQueue;
}

export function getImageUpscaleJobQueue() {
  imageUpscaleJobQueue ??= new Queue<{ jobId: string }>(imageUpscaleJobQueueName, {
    connection: createRedisProducerConnectionOptions(),
  });

  return imageUpscaleJobQueue;
}

export function getProductOutboxQueue() {
  productOutboxQueue ??= new Queue<{ eventId: string }>(productOutboxQueueName, {
    connection: createRedisProducerConnectionOptions(),
  });

  return productOutboxQueue;
}

export function getWmsEventQueue() {
  wmsEventQueue ??= new Queue<{ deliveryId: string }>(wmsEventQueueName, {
    connection: createRedisProducerConnectionOptions(),
  });
  return wmsEventQueue;
}

export function getAmazonSyncQueue() {
  amazonSyncQueue ??= new Queue<AmazonSyncQueueJob>(getAmazonSyncQueueName(), {
    connection: createRedisProducerConnectionOptions(),
  });
  return amazonSyncQueue;
}

export function getSellfoxSyncQueue() {
  sellfoxSyncQueue ??= new Queue<{ runId: string }>(sellfoxSyncQueueName, {
    connection: createRedisProducerConnectionOptions(),
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: 200 },
  });
  return sellfoxSyncQueue;
}
