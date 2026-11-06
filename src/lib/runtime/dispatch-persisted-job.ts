/** Call only after the database job and its input file have been committed. */
export async function dispatchPersistedJob(enqueue: () => Promise<unknown>, timeoutMs = 1500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(enqueue).then(() => ({ dispatchDeferred: false })),
      new Promise<{ dispatchDeferred: boolean }>(resolve => {
        timer = setTimeout(() => resolve({ dispatchDeferred: true }), timeoutMs);
      }),
    ]);
  } catch {
    // Durable queued intent remains recoverable. Never turn transport failure
    // into task failure or delete an input that a consumer may already use.
    return { dispatchDeferred: true };
  } finally { clearTimeout(timer); }
}
