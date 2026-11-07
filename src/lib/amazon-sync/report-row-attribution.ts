import type { NormalizedDomainReportRow } from "./domain-reports";
import { Prisma } from "@prisma/client";
import type { SyncScope } from "./policy";

export type ReportRowAttribution = { status: "VERIFIED"; marketplaceId: string } | { status: "MISSING_EVIDENCE" | "CONFLICTING_EVIDENCE" | "OUT_OF_SCOPE" };
const storeSites: Readonly<Record<string, string>> = {
  "amazon.com": "ATVPDKIKX0DER", "amazon.ca": "A2EUQ1WTGCTBG2",
  "amazon.com.mx": "A1AM78C64UM0Y8", "amazon.com.br": "A2Q3Y263D00KWC",
};
/**
 * orderMarketplaceIds must come from verified same-seller/scope order records,
 * never an order-number prefix, SKU, currency or fulfillment-center country.
 */
export function resolveReportRowAttribution(row: Pick<NormalizedDomainReportRow, "fields" | "orderId">, allowedMarketplaceIds: readonly string[], orderMarketplaceIds: readonly string[] = []): ReportRowAttribution {
  const evidence: string[] = [];
  const explicit = row.fields["marketplace-id"]?.trim();
  if (explicit) evidence.push(explicit);
  for (const key of ["marketplace-name", "store"] as const) {
    const name = row.fields[key]?.trim().toLowerCase();
    if (!name) continue;
    const site = storeSites[name];
    if (!site) return { status: "CONFLICTING_EVIDENCE" };
    evidence.push(site);
  }
  if (row.orderId) evidence.push(...orderMarketplaceIds);
  const unique = [...new Set(evidence)];
  if (!unique.length) return { status: "MISSING_EVIDENCE" };
  if (unique.length !== 1) return { status: "CONFLICTING_EVIDENCE" };
  if (!allowedMarketplaceIds.includes(unique[0])) return { status: "OUT_OF_SCOPE" };
  return { status: "VERIFIED", marketplaceId: unique[0] };
}

export const reportAttributionVersion = "verified-site-v1";
export function recoveredReportAttributionProof(documentCount: number, verifiedRows: number, isolatedRows: number) {
  const complete = documentCount > 0 && isolatedRows === 0;
  return { status: complete ? "VERIFIED" : "PENDING_VERIFICATION", version: "explicit-report-row.v1", verifiedRows, parsedRows: verifiedRows + isolatedRows, complete };
}
export function hasCompleteReportAttributionProof(proof: unknown) {
  return !!proof && typeof proof === "object" && !Array.isArray(proof) &&
    "status" in proof && proof.status === "VERIFIED" &&
    "version" in proof && proof.version === "explicit-report-row.v1" &&
    "complete" in proof && proof.complete === true;
}
export async function markReportRowAttribution(tx: Prisma.TransactionClient, scope: SyncScope, source: { authorizationId: string; sellerAccountId: string; marketplaceId: string; authorization: { amazonSellerId: string; revision: number } }, rows: NormalizedDomainReportRow[]) {
  const orderIds = [...new Set(rows.flatMap(r => r.orderId ? [r.orderId] : []))];
  const orders = orderIds.length ? await tx.amazonOrderRecord.findMany({ where: { ...scope, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, amazonOrderId: { in: orderIds }, source: { authorizationId: source.authorizationId, authorization: { identityVerifiedAt: { not: null } } }, task: { authorizationRevision: source.authorization.revision, executionVersion: 2, status: "SUCCEEDED", frozenScope: { path: ["amazonSellerId"], equals: source.authorization.amazonSellerId } } }, select: { amazonOrderId: true, marketplaceId: true } }) : [];
  return rows.map(row => {
    const decision = resolveReportRowAttribution(row, [source.marketplaceId], orders.filter(o => o.amazonOrderId === row.orderId).map(o => o.marketplaceId));
    return { ...row, fields: { ...row.fields, __siteEvidenceVersion: reportAttributionVersion, __siteEvidenceStatus: decision.status, __verifiedMarketplaceId: decision.status === "VERIFIED" ? decision.marketplaceId : "" } };
  });
}

export async function persistReportAttributionMarkers(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, documentId: string, rows: Array<{ rowNumber: number; rowHash: string; fields: Record<string, string> }>) {
  if (!rows.length) return;
  const patch = rows.map(r => ({ rowNumber: r.rowNumber, rowHash: r.rowHash, marker: { __siteEvidenceVersion: r.fields.__siteEvidenceVersion, __siteEvidenceStatus: r.fields.__siteEvidenceStatus, __verifiedMarketplaceId: r.fields.__verifiedMarketplaceId } }));
  await tx.$executeRaw(Prisma.sql`UPDATE "AmazonSyncReportRow" r SET fields = r.fields || p.marker FROM jsonb_to_recordset(${JSON.stringify(patch)}::jsonb) AS p("rowNumber" integer, "rowHash" text, marker jsonb) WHERE r."organizationId"=${scope.organizationId} AND r."workspaceId"=${scope.workspaceId} AND r."sourceId"=${sourceId} AND r."reportDocumentId"=${documentId} AND r."rowNumber"=p."rowNumber" AND r."rowHash"=p."rowHash"`);
}

export function reportVerifiedRowWhere(resource: string, marketplaceId: string): Prisma.AmazonSyncReportRowWhereInput {
  return ["inventory_events", "reimbursements"].includes(resource) ? { AND: [{ fields: { path: ["__siteEvidenceVersion"], equals: reportAttributionVersion } }, { fields: { path: ["__siteEvidenceStatus"], equals: "VERIFIED" } }, { fields: { path: ["__verifiedMarketplaceId"], equals: marketplaceId } }] } : {};
}

export function requiresReportRowAttribution(resource: string) {
  return resource === "inventory_events" || resource === "reimbursements";
}
/** Request marketplace, warehouse country and matching document metadata are not row evidence. */
export function reportAttributionSummary(rows: readonly Pick<NormalizedDomainReportRow, "fields" | "orderId">[], marketplaceId: string) {
  const counts = { verified: 0, missing: 0, conflicting: 0, outside: 0 };
  for (const row of rows) {
    const result = resolveReportRowAttribution(row, [marketplaceId]);
    if (result.status === "VERIFIED") counts.verified++;
    else if (result.status === "MISSING_EVIDENCE") counts.missing++;
    else if (result.status === "CONFLICTING_EVIDENCE") counts.conflicting++;
    else counts.outside++;
  }
  return { ...counts, complete: counts.verified === rows.length };
}
