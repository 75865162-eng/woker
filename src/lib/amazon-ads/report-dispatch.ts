import { AdsQueryError } from "./query-contract";

/** Reserved queue route. An environment flag or a manually entered account ID cannot enable it. */
export const reportingV1DispatchReadiness = Object.freeze({
  liveEnabled: false,
  blockers: Object.freeze(["CAMPAIGN_FIELDS_UNVERIFIED", "ACCOUNT_BINDING_UNVERIFIED", "DOWNLOAD_HOSTS_UNVERIFIED", "PERSISTENT_V1_RUNTIME_NOT_IMPLEMENTED"]),
});

export function rejectUnverifiedReportingV1Dispatch(): never {
  // Runs before any token refresh, DB mutation, HTTP request or fallback processor.
  throw new AdsQueryError("ADS_REPORT_V1_LIVE_DISPATCH_DISABLED", 403);
}
