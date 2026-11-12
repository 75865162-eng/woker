import type { Prisma } from "@prisma/client";
import { SyncInputError } from "./policy";

export function orderDetailGapWhere(policyDigest: string | null, sourceUpdatedAt: Prisma.FieldRef<"AmazonOrderRecord", "DateTime">): Prisma.AmazonOrderRecordWhereInput {
  if (!policyDigest) return {};
  return { OR: [{ detailPolicyDigest: null }, { detailPolicyDigest: { not: policyDigest } }, { detailsUpdatedAt: null }, { detailsUpdatedAt: { lt: sourceUpdatedAt } }] };
}

/** Applied before count/pagination, across each source's current detail policy.
 * A list-only source has no current details; it never proves a collection gap is eligible. */
export function orderDetailStatusWhere(params: URLSearchParams, digests: Map<string, string | null>, sourceUpdatedAt: Prisma.FieldRef<"AmazonOrderRecord", "DateTime">): Prisma.AmazonOrderRecordWhereInput {
  const status = params.get("detailsStatus");
  if (params.getAll("detailsStatus").length > 1 || status !== null && !["", "CURRENT", "MISSING_OR_STALE"].includes(status)) throw new SyncInputError("订单明细状态筛选无效。");
  if (!status) return {};
  return { OR: [...digests].map(([sourceId, policyDigest]) => ({ sourceId, ...(status === "MISSING_OR_STALE" ? orderDetailGapWhere(policyDigest, sourceUpdatedAt) : policyDigest ? { detailPolicyDigest: policyDigest, detailsUpdatedAt: { gte: sourceUpdatedAt } } : { id: { in: [] } }) })) };
}
