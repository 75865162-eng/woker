import { processImportJob } from "@/lib/jobs/processor";
import { getImageUpscaleJobQueue, getImportJobQueue } from "@/lib/queue/redis-queue";

export async function enqueueImportJob(jobId: string) {
  const driver = process.env.QUEUE_DRIVER ?? "inline";

  if (driver === "inline") {
    await processImportJob(jobId);
    return;
  }

  if (driver === "redis") {
    await getImportJobQueue().add(
      "process-import-job",
      { jobId },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    return;
  }

  throw new Error(`Unsupported queue driver: ${driver}`);
}

export async function enqueueImageUpscaleJob(jobId: string) {
  if (process.env.QUEUE_DRIVER !== "redis") {
    throw new Error("图片放大必须启用 Redis Worker。请配置 QUEUE_DRIVER=redis。");
  }

  await getImageUpscaleJobQueue().add(
    "process-image-upscale-job",
    { jobId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
}
