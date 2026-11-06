import { prisma } from "@/lib/db/prisma";
import { processImageUpscale } from "@/lib/image-upscale/engine";
import { claimExecution, ExecutionLostError } from "@/lib/runtime/job-execution";

export async function processImageUpscaleJob(jobId: string, engine = processImageUpscale) {
  const execution = await claimExecution("image-upscale", jobId);
  if (!execution) return;

  try {
    await execution.write(tx => tx.imageUpscaleJob.update({ where: { id: jobId }, data: { progress: 10, startedAt: new Date(), error: null } }));
    const job = await prisma.imageUpscaleJob.findUniqueOrThrow({ where: { id: jobId } });
    const outputKey = `image-upscale/results/${job.id}/${execution.token}.png`;
    const result = await engine({
      inputKey: job.inputKey,
      outputKey,
      scale: job.scale as 2 | 4,
      model: job.model,
    });
    await execution.write(tx => tx.imageUpscaleJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        outputKey,
        leaseExpiresAt: null,
        ...result,
        completedAt: new Date(),
      },
    }));
  } catch (error) {
    if (error instanceof ExecutionLostError) return;
    const message = error instanceof Error ? error.message : "图片放大失败。";
    await execution.write(tx => tx.imageUpscaleJob.update({
      where: { id: jobId },
      data: { status: "failed", progress: 0, error: message, leaseExpiresAt: null },
    })).catch(failure => { if (!(failure instanceof ExecutionLostError)) throw failure; });
    throw error;
  } finally {
    execution.dispose();
  }
}
