import type { Prisma } from "@prisma/client";
import { digest, unseal } from "./approval-policy";
import { parseObservationPolicy } from "./observation-policy";
import { parseObservationState } from "./observation-machine";
import { assertProductDiscoveryHead, resolvedProductPolicy, validateProductManifest } from "./product-discovery";
import { parseProductDetail } from "./product-observations";
import { activeTaskStatuses, SyncInputError, type SyncScope } from "./policy";

/** An explicit publication of verified available objects, never a complete snapshot. */
export async function inspectProductPartialPublication(tx: Prisma.TransactionClient, scope: SyncScope, taskId: string) {
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, executionVersion: 2 }, include: { source: { include: { authorization: true } } } });
  const source = run.source, frozen = run.frozenScope as Prisma.JsonObject;
  const reject = (): never => { throw new SyncInputError("部分发布要求已停止的目录任务、完整缺口清单和一致的原件、结构化数据及授权版本。", 409); };
  if (!source || run.resource !== "catalog_items" || run.status !== "PARTIAL_SUCCESS" || run.stage !== "OBJECTS_UNAVAILABLE" || !run.paginationComplete || !run.finishedAt
    || run.leaseOwner || run.leaseExpiresAt || run.control || !run.checkpointCiphertext || !source.enabled || source.authorization.status !== "CONFIGURED"
    || frozen.sourceRevision !== source.revision || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision
    || frozen.sellerAccountId !== source.sellerAccountId || frozen.marketplaceId !== source.marketplaceId || frozen.amazonSellerId !== source.authorization.amazonSellerId
    || frozen.region !== source.authorization.awsRegion || frozen.endpoint !== source.authorization.endpoint || digest(frozen) !== run.frozenScopeDigest
    || digest(frozen.domainPolicy) !== digest(source.domainPolicy)) return reject();
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: source.id, id: { not: taskId }, status: { in: activeTaskStatuses } } })) return reject();
  const policy = resolvedProductPolicy(parseObservationPolicy(frozen.domainPolicy, "catalog_items"), frozen.productManifest);
  if (policy.resource !== "catalog_items") return reject();
  if (policy.discovery) await assertProductDiscoveryHead(tx, scope, source, validateProductManifest(frozen.productManifest, policy));
  const state = parseObservationState(unseal(run.checkpointCiphertext, scope, run.id, "amazon-observation-state.v1").state, policy);
  const missing = state.unavailableObjectIndexes ?? [];
  if (state.stage !== "COMPLETE" || state.planIndex !== policy.asins.length || !missing.length || missing.length >= policy.asins.length) return reject();
  const rows = await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceId: source.id, sourceRunId: run.id }, orderBy: { id: "asc" } });
  const wanted = new Set(policy.asins.filter((_, index) => !missing.includes(index)));
  if (rows.length !== wanted.size || rows.length !== run.insertedCount || run.processedCount !== run.insertedCount + run.skippedCount || run.updatedCount || run.skippedCount) return reject();
  const rawPages = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId: run.id, resource: "catalog_items" }, orderBy: { page: "asc" } });
  const verified = new Map<string, string>();
  for (const raw of rawPages) {
    const body = unseal(raw.rawCiphertext, scope, `${run.id}:${raw.page}`, (raw.page < 0 ? "amazon-catalog_items-raw.v1" : "amazon-observation-raw.v1")).rawBody;
    if (typeof body !== "string" || digest(body) !== raw.bodySha256) return reject();
    if (raw.page < 0) continue;
    const metadata = raw.requestMetadata as { operation?: string; objectIndex?: number };
    if (metadata.operation !== "getCatalogItem") continue;
    const index = metadata.objectIndex ?? policy.asins.indexOf((JSON.parse(body) as { asin?: string }).asin ?? "");
    if (index === -1) continue;
    if (index < 0 || index >= policy.asins.length) return reject();
    if (!wanted.has(policy.asins[index])) continue; // The missing object's error archive remains untouched.
    const fact = parseProductDetail(body, policy, index, source.marketplaceId);
    const hash = digest({ kind: fact.kind, businessKey: fact.businessKey, asin: fact.asin, sellerSku: fact.sellerSku, searchTerm: fact.searchTerm, facts: fact.facts });
    if (verified.has(fact.businessKey) && verified.get(fact.businessKey) !== hash) return reject();
    verified.set(fact.businessKey, hash);
  }
  for (const row of rows) {
    if (!row.asin || !wanted.delete(row.asin) || verified.get(row.businessKey) !== digest({ kind: row.kind, businessKey: row.businessKey, asin: row.asin, sellerSku: row.sellerSku, searchTerm: row.searchTerm, facts: row.facts })) return reject();
  }
  if (wanted.size || verified.size !== rows.length) return reject();
  const coverage = { type: "APPROVED_SCOPE_OBSERVATION", resource: "catalog_items", complete: false, accountUniverseComplete: false, rowCount: rows.length,
    requestedObjects: policy.asins.length, unavailableObjects: missing.length, unavailableObjectIndexes: missing, unavailableObjectIds: missing.map(index => policy.asins[index]), reason: "UPSTREAM_OBJECT_NOT_FOUND", marketplaceVerified: true };
  return { run, source, coverage, evidence: { taskId, checkpointDigest: digest(run.checkpointCiphertext), rowsDigest: digest(rows.map(row => [row.id, row.facts])), rawDigest: digest(rawPages.map(page => [page.page, page.bodySha256])), previousHead: source.activeRunId, coverage } };
}
