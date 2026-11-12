/** Report identities are durable. A retry must never turn an uncertain create
 * or an archived document into a fresh report request. Snapshot API pagination
 * uses a different checkpoint and keeps its existing restart policy. */
export function preservesReportCheckpoint(resource: string, frozenScope: unknown): boolean {
  if (resource === "sales_traffic") return true;
  if (resource !== "catalog" || !frozenScope || typeof frozenScope !== "object" || Array.isArray(frozenScope)) return false;
  return "amazonSellerId" in frozenScope && frozenScope.amazonSellerId === "";
}

/** Older partial reports discarded their checkpoint on completion. Reconstruct
 * only the report/document identity already persisted in their own summary. */
export function completedReportIdentity(summary: unknown): { reportId: string; documentId: string } | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary) || !("coverage" in summary)) return null;
  const coverage = summary.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
  if (!("reportId" in coverage) || !("documentId" in coverage) || !validId(coverage.reportId) || !validId(coverage.documentId)) return null;
  return { reportId: coverage.reportId, documentId: coverage.documentId };
}
