import { processImportJob } from "@/lib/jobs/processor";
import { getImportJobQueue } from "@/lib/queue/redis-queue";

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
