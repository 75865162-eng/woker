import { AdsQueryError } from "./query-contract";

/** Consumed calls survive restarts; do not reset the exponent per dispatch. */
export function reportReadRetryAt(attempt: number, retryAfter: string | null = null, now = Date.now()): number {
  const backoff = Math.min(60000, 1000 * 2 ** Math.max(0, Math.min(attempt - 1, 6)));
  let upstream = 0;
  if (retryAfter !== null) {
    const value = retryAfter.trim();
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      // Unrepresentable upstream waits must block, never silently shorten the wait.
      upstream = Number.isSafeInteger(seconds) && seconds <= (8640000000000000 - now) / 1000 ? now + seconds * 1000 : Infinity;
    } else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) upstream = parsed;
    }
  }
  return Math.max(now + backoff, upstream);
}

export class ReportReadRetryError extends AdsQueryError {
  constructor(code: "ADS_REPORT_THROTTLED" | "ADS_REPORT_UPSTREAM_UNAVAILABLE", readonly retryAt: number) {
    super(code);
  }
}
