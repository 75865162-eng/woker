// Opt-in diagnostics: operation names and durations only, never identities or SQL parameters.
export async function measureServerOperation<T>(operation: string, run: () => Promise<T>): Promise<T> {
  if (process.env.ERP_PERFORMANCE_TRACE !== "1") return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    console.info(JSON.stringify({ event: "erp.performance", operation, durationMs: +(performance.now() - start).toFixed(2) }));
  }
}
