import { getSellfoxSyncQueue } from "@/lib/queue/redis-queue";
import { enqueueSellfoxSyncRun } from "@/lib/queue";

type RecoveryJob = { getState: () => Promise<string>; retry: (state: "failed") => Promise<unknown>; remove: () => Promise<unknown> };
type RecoveryQueue = { getJob: (id: string) => Promise<RecoveryJob | undefined> };
/** Called only for DB-queued runs. DB executionAttempts bounds retries even after Redis loses its history. */
export async function recoverSellfoxQueueRun(runId: string, queue: RecoveryQueue = getSellfoxSyncQueue(), enqueue = enqueueSellfoxSyncRun) {
  const job = await queue.getJob(`sellfox-${runId}`);
  if (job) {
    const state = await job.getState();
    if (state === "failed") { await job.retry("failed"); return; }
    if (state !== "completed") return; // BullMQ owns active, delayed, waiting and stalled jobs.
    await job.remove();
  }
  await enqueue(runId);
}
