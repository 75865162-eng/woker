import { createHash } from "node:crypto";
import { AdsQueryError } from "./query-contract";

type ReportScopeTask = {
  id: string; organizationId: string; workspaceId: string; requestedByUserId: string;
  planId: string; planRevision: number; profileId: string;
  requestedFrom: Date | null; requestedTo: Date | null;
};
type ReportScopeProfile = {
  id: string; authorizationId: string; profileId: string; region: string;
  sellerAccountId: string | null; marketplaceId: string | null;
  currencyCode: string | null; timezone: string | null;
};

/** Stable identity and contract evidence, independent of lease renewal and JSONB key order. */
export function reportScopeDigest(task: ReportScopeTask, profile: ReportScopeProfile, authorizationRevision: number, manifest: Record<string, unknown>): string {
  const contract = Object.keys(manifest).sort().map(key => [key, manifest[key]]);
  return createHash("sha256").update(JSON.stringify([
    task.id, task.organizationId, task.workspaceId, task.requestedByUserId,
    task.planId, task.planRevision, task.profileId,
    task.requestedFrom?.toISOString(), task.requestedTo?.toISOString(),
    profile.id, profile.authorizationId, authorizationRevision, profile.profileId, profile.region,
    profile.sellerAccountId, profile.marketplaceId, profile.currencyCode, profile.timezone, contract,
  ])).digest("hex");
}

export function assertReportScopeDigest(stored: unknown, current: string) {
  if (typeof stored !== "string" || stored !== current) throw new AdsQueryError("ADS_REPORT_FROZEN_SCOPE_CHANGED", 409);
}
