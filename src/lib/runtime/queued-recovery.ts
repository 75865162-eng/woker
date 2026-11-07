/** Only queued intent is safe without an execution lease. Never reset running work. */
export async function recoverQueuedJobs(
  read: () => Promise<Array<{ id: string }>>,
  enqueue: (id: string) => Promise<unknown>,
) {
  const jobs = await read();
  for (const job of jobs) await enqueue(job.id);
  return jobs.length;
}
