import { AdsQueryError } from "./query-contract";

/** A broken upstream cancel hook must not hold a worker or mask the original error. */
export function cancelReportBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

export async function readBoundedReportBody(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) { cancelReportBody(response); throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT"); }
  if (!response.ok || response.status !== 200 || response.redirected) { cancelReportBody(response); throw new AdsQueryError("ADS_REPORT_HTTP_OR_REDIRECT_REJECTED"); }
  const announced = response.headers.get("content-length");
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > limit)) { cancelReportBody(response); throw new AdsQueryError("ADS_REPORT_BODY_LIMIT"); }
  const reader = response.body?.getReader();
  if (!reader) throw new AdsQueryError("ADS_REPORT_BODY_MISSING");
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => { reject(new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT")); cancel(); };
    signal.addEventListener("abort", abort, { once: true });
  });
  const chunks: Buffer[] = []; let size = 0;
  const read = async () => {
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) throw new AdsQueryError("ADS_REPORT_OPERATION_TIMEOUT");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new AdsQueryError("ADS_REPORT_BODY_LIMIT");
      chunks.push(Buffer.from(next.value));
    }
    if (announced !== null && size !== Number(announced)) throw new AdsQueryError("ADS_REPORT_BODY_SIZE_MISMATCH");
    return Buffer.concat(chunks);
  };
  try {
    return await Promise.race([read(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
    cancel();
    reader.releaseLock();
  }
}
