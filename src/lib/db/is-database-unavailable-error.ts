export function isDatabaseUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes("Can't reach database server") ||
    error.message.includes("database server at") ||
    error.message.includes("connect ECONNREFUSED") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("timeout") ||
    error.message.includes("P1001") ||
    error.message.includes("P1002") ||
    error.message.includes("P1017")
  );
}
