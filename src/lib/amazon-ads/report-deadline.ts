import { AdsQueryError } from "./query-contract";

/** A task deadline is immutable work authorization, including local stage/publish. */
export function assertReportDeadline(deadline: unknown) {
  const end = typeof deadline === "string" ? Date.parse(deadline) : NaN;
  if (!Number.isFinite(end) || end <= Date.now()) throw new AdsQueryError("ADS_REPORT_DEADLINE_EXCEEDED");
}
