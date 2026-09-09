import { prisma } from "@/lib/db/prisma";
import { processImageUpscale } from "@/lib/image-upscale/engine";

export async function processImageUpscaleJob(jobId: string) {
  const job = await prisma.imageUpscaleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Image upscale job not found.");

  await prisma.imageUpscaleJob.update({
    where: { id: jobId },
    data: { status: "running", progress: 10, startedAt: new Date(), error: null },
  });

  try {
    const result = await processImageUpscale({
      inputKey: job.inputKey,
      outputKey: `image-upscale/results/${job.id}.png`,
      scale: job.scale as 2 | 4,
      model: job.model,
    });
    await prisma.imageUpscaleJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        outputKey: `image-upscale/results/${job.id}.png`,
        ...result,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片放大失败。";
    await prisma.imageUpscaleJob.update({
      where: { id: jobId },
      data: { status: "failed", progress: 0, error: message },
    });
    throw error;
  }
}
