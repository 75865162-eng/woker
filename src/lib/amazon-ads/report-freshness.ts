export type ReportFreshnessStatus = "CURRENT" | "STALE" | "FAILED" | "SYNCING" | "MISSING" | "OBSERVED_PUBLISHED";
export type ReportDomainState = {
  profileId: string; reportType: string; status: string; warningCodes: string[];
  lastAttemptAt: Date | null; lastTaskId: string | null;
};

/** A structure plan cadence is not a report freshness SLA. */
export function publishedReportFreshness(hasPublishedFacts: boolean, domainStatus?: string): ReportFreshnessStatus {
  if (["FAILED", "BLOCKED", "CANCELLED"].includes(domainStatus ?? "")) return "FAILED";
  if (["RUNNING", "SYNCING", "RETRY_WAIT", "WAITING", "QUEUED", "WAITING_FOR_ADAPTER", "WAITING_FOR_CONFIG"].includes(domainStatus ?? "")) return "SYNCING";
  if (!hasPublishedFacts) return "MISSING";
  if (domainStatus === "STALE") return "STALE";
  return "OBSERVED_PUBLISHED";
}

/** Exact-domain state takes precedence; all-domain reads keep the worst known state. */
export function selectReportDomainState<T extends ReportDomainState>(states: readonly T[], profileId: string, reportType?: string): T | undefined {
  let candidates = states.filter(state => state.profileId === profileId && (!reportType || state.reportType === reportType || state.reportType === ""));
  if (reportType && candidates.some(state => state.reportType === reportType)) candidates = candidates.filter(state => state.reportType === reportType);
  const rank = (state: T) => ({ FAILED: 0, SYNCING: 1, STALE: 2, MISSING: 3, OBSERVED_PUBLISHED: 4, CURRENT: 4 })[publishedReportFreshness(true, state.status)];
  return candidates.sort((left, right) => rank(left) - rank(right)
    || (right.lastAttemptAt?.getTime() ?? 0) - (left.lastAttemptAt?.getTime() ?? 0)
    || left.reportType.localeCompare(right.reportType)
    || (left.lastTaskId ?? "").localeCompare(right.lastTaskId ?? ""))[0];
}

export function summarizeReportFreshness(statuses: ReportFreshnessStatus[]) {
  if (!statuses.length) return "MISSING";
  if (statuses.includes("FAILED")) return "FAILED";
  if (statuses.includes("SYNCING")) return "SYNCING";
  if (statuses.every(status => status === "MISSING")) return "MISSING";
  if (statuses.includes("MISSING")) return "PARTIAL";
  if (statuses.includes("STALE")) return "STALE";
  return "OBSERVED_PUBLISHED";
}
