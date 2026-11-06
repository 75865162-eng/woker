/** Counts describe saved current facts only, never missing dates or unseen Amazon rows. */
export const reportMetricFields = ["impressions", "clicks", "orders", "units", "spend", "sales"] as const;
export type ReportMetricField = typeof reportMetricFields[number];
export type ReportMetricCompleteness = {
  providedFactCount: string;
  missingFactCount: string;
  status: "COMPLETE" | "PARTIAL" | "MISSING" | "NO_FACTS";
};
export type ReportCompleteness = {
  basis: "CURRENT_OBSERVED_FACTS";
  observedFactCount: string;
  metrics: Record<ReportMetricField, ReportMetricCompleteness>;
};

export function reportCompleteness(observed: bigint, provided: Record<ReportMetricField, bigint>): ReportCompleteness {
  if (observed < BigInt(0)) throw new Error("ADS_REPORT_COMPLETENESS_INVALID");
  const metrics = {} as ReportCompleteness["metrics"];
  for (const field of reportMetricFields) {
    const count = provided[field];
    if (typeof count !== "bigint" || count < BigInt(0) || count > observed) throw new Error("ADS_REPORT_COMPLETENESS_INVALID");
    metrics[field] = {
      providedFactCount: count.toString(), missingFactCount: (observed - count).toString(),
      status: observed === BigInt(0) ? "NO_FACTS" : count === observed ? "COMPLETE" : count === BigInt(0) ? "MISSING" : "PARTIAL",
    };
  }
  return { basis: "CURRENT_OBSERVED_FACTS", observedFactCount: observed.toString(), metrics };
}
