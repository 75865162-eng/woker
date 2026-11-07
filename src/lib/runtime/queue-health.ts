/** Redis outages must not prevent the page from showing database heartbeats. */
export async function queueHealth(read: () => Promise<Record<string, number>>, timeoutMs = 1500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read().then(counts => ({ available: true, counts })),
      new Promise<{ available: boolean; counts: Record<string, number> }>(resolve => {
        timer = setTimeout(() => resolve({ available: false, counts: {} }), timeoutMs);
      }),
    ]);
  } catch {
    return { available: false, counts: {} };
  } finally { clearTimeout(timer); }
}
