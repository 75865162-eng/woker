import type { AcquisitionState } from "./report-acquisition";
import { AdsQueryError } from "./query-contract";

const phases = ["CREATE", "POLL", "DOWNLOAD", "STAGE", "PUBLISH", "COMPLETE"];
const budgets = { create: 1, poll: 10, download: 3 } as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Persisted JSON is untrusted. Never repair counters or drop a malformed reservation. */
export function readReportAcquisitionState(value: unknown): AcquisitionState {
  const invalid = () => { throw new AdsQueryError("ADS_REPORT_CHECKPOINT_INVALID", 409); };
  if (!record(value) || value.version !== 1 || typeof value.phase !== "string" || !phases.includes(value.phase)) return invalid();
  const calls = value.calls;
  if (!record(calls)) return invalid();
  for (const operation of Object.keys(budgets) as Array<keyof typeof budgets>) {
    const count = calls[operation];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > budgets[operation]) return invalid();
  }
  if (value.nextPollAt !== undefined && (typeof value.nextPollAt !== "string" || !Number.isFinite(Date.parse(value.nextPollAt)))) return invalid();
  if (value.reserved !== undefined) {
    const reservation = value.reserved;
    if (!record(reservation) || typeof reservation.operation !== "string" || !Object.hasOwn(budgets, reservation.operation)) return invalid();
    const operation = reservation.operation as keyof typeof budgets;
    if (value.phase !== operation.toUpperCase() || (calls[operation] as number) < 1
      || typeof reservation.fence !== "number" || !Number.isSafeInteger(reservation.fence) || reservation.fence < 0
      || typeof reservation.owner !== "string" || !reservation.owner || reservation.owner.length > 200) return invalid();
  }
  if (!Array.isArray(value.evidenceFileIds) || value.evidenceFileIds.some(id => typeof id !== "string" || !id || id.length > 200)
    || value.evidenceFileIds.length > 11 || new Set(value.evidenceFileIds).size !== value.evidenceFileIds.length) return invalid();
  if (value.expectedRows !== undefined && (typeof value.expectedRows !== "number" || !Number.isSafeInteger(value.expectedRows) || value.expectedRows < 1 || value.expectedRows > 1000)) return invalid();
  return value as unknown as AcquisitionState;
}
