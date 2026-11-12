import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { digest, unseal } from "./approval-policy";
import { parseObservationState } from "./observation-machine";
import { parseObservationPolicy } from "./observation-policy";
import { resolvedProductPolicy, validateProductManifest, assertProductDiscoveryHead } from "./product-discovery";
import { SyncInputError } from "./policy";

/** Binds a new approval to the original product progress, including a stopped
 * task. No objects are rediscovered, no records are deleted and no HTTP occurs. */
export async function inspectProductRecovery(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const reject = (): never => { throw new SyncInputError("商品详情恢复范围或检查点已变化；保留原件和记录，请重新核对。", 409); };
  if (!["catalog_items", "listing_details"].includes(run.resource) || !run.sourceId
    || !["FAILED", "BLOCKED", "PARTIAL_SUCCESS", "PAUSED", "CANCELLED"].includes(run.status)
    || ["PURGED", "BINDING_DISABLED"].includes(run.stage) || run.leaseOwner || run.leaseExpiresAt || run.control) return reject();
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId }, include: { authorization: true } });
  const frozen = run.frozenScope as Prisma.JsonObject | null;
  if (!source || !source.enabled || source.resource !== run.resource || source.authorization.status !== "CONFIGURED" || !frozen
    || digest(frozen) !== run.frozenScopeDigest || frozen.sourceId !== source.id || frozen.sourceRevision !== source.revision
    || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision
    || frozen.amazonSellerId !== source.authorization.amazonSellerId || frozen.sellerAccountId !== source.sellerAccountId
    || frozen.marketplaceId !== source.marketplaceId || frozen.resource !== run.resource
    || frozen.region !== source.authorization.awsRegion || frozen.endpoint !== source.authorization.endpoint
    || digest(frozen.domainPolicy) !== digest(source.domainPolicy)) return reject();
  if (!run.checkpointCiphertext && (run.status === "CANCELLED" || run.pagesCompleted || run.processedCount)) return reject();
  const policy = resolvedProductPolicy(parseObservationPolicy(frozen.domainPolicy, run.resource), frozen.productManifest);
  if (policy.resource !== "catalog_items" && policy.resource !== "listing_details") return reject();
  if (policy.discovery) await assertProductDiscoveryHead(tx, scope, source, validateProductManifest(frozen.productManifest, policy));
  const state = parseObservationState(run.checkpointCiphertext ? unseal(run.checkpointCiphertext, scope, run.id, "amazon-observation-state.v1").state : null, policy);
  const records = await tx.amazonDomainObservation.count({ where: { ...scope, sourceId: source.id, sourceRunId: run.id } });
  if (records !== run.insertedCount || run.insertedCount + run.skippedCount !== run.processedCount || run.updatedCount) return reject();
  return { mode: "RESUME_FROZEN_PRODUCT_CHECKPOINT", previousStatus: run.status, checkpointDigest: digest(run.checkpointCiphertext),
    frozenDigest: run.frozenScopeDigest, pagesCompleted: run.pagesCompleted, recordsPreserved: records,
    requestsUsed: state.requests, nextObjectIndex: state.planIndex, unavailableObjects: state.unavailableObjectIndexes?.length ?? 0,
    requestedObjects: policy.resource === "catalog_items" ? policy.asins.length : policy.sellerSkus.length,
    restartsFromBeginning: false, cancellationReopened: run.status === "CANCELLED" };
}
