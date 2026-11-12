import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SyncInputError, type SyncScope } from "./policy";
import type { ListingDetailPolicy, CatalogDetailPolicy, PricingPolicy, ObservationPolicy } from "./observation-policy";
type ProductPolicy = ListingDetailPolicy | CatalogDetailPolicy | PricingPolicy;
type Source = { id: string; authorizationId: string; sellerAccountId: string; marketplaceId: string; authorization: { revision: number; amazonSellerId: string } };
export type ProductManifest = { sourceId: string; sourceRevision: number; runId: string; authorizationRevision: number; total: number; ids: string[]; digest: string; batchSize: 100 };
const hash = (ids: string[]) => createHash("sha256").update(JSON.stringify(ids)).digest("hex");
function rejected(): never { throw new SyncInputError("商品发现需要当前身份、授权版本一致的完整在线商品快照；快照变更或范围超预算时保留旧详情版本。", 409); }
export function validateProductManifest(value: unknown, policy: ProductPolicy): ProductManifest {
  const m = value as ProductManifest | null;
  if (!policy.discovery || !m || m.sourceId !== policy.discovery.sourceId || !Number.isSafeInteger(m.sourceRevision) || m.sourceRevision < 1 || !Number.isSafeInteger(m.authorizationRevision) || m.authorizationRevision < 1 || typeof m.runId !== "string" || !m.runId || m.batchSize !== 100 || !Array.isArray(m.ids) || m.total !== m.ids.length || m.total > policy.discovery.maxObjects || m.total > policy.maxRows || (policy.resource === "pricing" ? 2 * Math.ceil(m.total / 20) : m.total) > policy.maxRequests || hash(m.ids) !== m.digest) rejected();
  const pattern = policy.resource === "listing_details" ? /^[^\u0000-\u001f\u007f]{1,255}$/ : /^[A-Z0-9]{10}$/;
  if (m.ids.some(v => typeof v !== "string" || !pattern.test(v)) || new Set(m.ids).size !== m.ids.length || m.ids.some((v, i) => i > 0 && m.ids[i - 1] >= v)) rejected();
  return m;
}
export async function assertProductDiscoveryHead(tx: Prisma.TransactionClient, scope: SyncScope, source: Source, manifest: ProductManifest) {
  const upstream = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: manifest.sourceId, resource: "catalog", authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId } });
  // The manifest freezes an immutable complete snapshot. A newer upstream head
  // must not invalidate an in-flight detail round; authorization/source revision
  // changes and purged/incomplete snapshots still reject it.
  const snapshot = upstream ? await tx.amazonSyncRun.findFirst({ where: { ...scope, id: manifest.runId, sourceId: upstream.id, resource: "catalog" } }) : null;
  const frozen = snapshot?.frozenScope as Record<string, unknown> | undefined;
  const coverage = (snapshot?.summary as { coverage?: Record<string, unknown> } | null)?.coverage;
  if (!upstream || upstream.id === source.id || !upstream.enabled || upstream.revision !== manifest.sourceRevision || !snapshot || snapshot.status !== "SUCCEEDED" || snapshot.stage === "PURGED" || snapshot.executionVersion !== 2 || !snapshot.finishedAt || !snapshot.paginationComplete || coverage?.type !== "complete_snapshot" || coverage.paginationComplete !== true || frozen?.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision || !source.authorization.amazonSellerId || frozen.amazonSellerId !== source.authorization.amazonSellerId || manifest.authorizationRevision !== source.authorization.revision) rejected();
  // An empty manifest requires positive evidence of a complete empty snapshot,
  // not merely an absent catalog projection or an unstarted upstream task.
  if (manifest.total === 0 && (coverage.rowCount !== 0 || snapshot.insertedCount !== 0 || await tx.amazonCatalogSnapshot.count({ where: { ...scope, sourceRunId: manifest.runId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId } }) !== 0)) rejected();
  return upstream;
}
/** Read immutable rows in batches, freeze one bounded whole-round manifest. */
export async function discoverProductObjects(tx: Prisma.TransactionClient, scope: SyncScope, source: Source, policy: ObservationPolicy): Promise<ProductManifest | undefined> {
  if (policy.resource !== "listing_details" && policy.resource !== "catalog_items" && policy.resource !== "pricing" || !policy.discovery) return;
  const head = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: policy.discovery.sourceId, resource: "catalog", authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }, select: { revision: true, activeRunId: true, rowCount: true } });
  if (!head?.activeRunId || head.rowCount > 1000) rejected();
  // Validate the head using its published count before the page scan resolves
  // unique object IDs; a nonempty snapshot is not an empty manifest.
  const manifest: ProductManifest = { sourceId: policy.discovery.sourceId, sourceRevision: head.revision, runId: head.activeRunId, authorizationRevision: source.authorization.revision, total: head.rowCount, ids: [], digest: "", batchSize: 100 };
  await assertProductDiscoveryHead(tx, scope, source, manifest);
  let after: string | undefined; let rows = 0; const ids = new Set<string>();
  for (;;) {
    const page = await tx.amazonCatalogSnapshot.findMany({ where: { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: head.activeRunId, ...(after ? { sellerSku: { gt: after } } : {}) }, orderBy: { sellerSku: "asc" }, take: 100, select: { sellerSku: true, asin: true } });
    for (const row of page) { rows++; ids.add(policy.resource === "listing_details" ? row.sellerSku : row.asin); }
    if (rows > 1000 || ids.size > policy.discovery.maxObjects) rejected();
    if (page.length < 100) break;
    after = page.at(-1)!.sellerSku;
  }
  if (rows !== head.rowCount) rejected();
  manifest.ids = [...ids].sort(); manifest.total = ids.size; manifest.digest = hash(manifest.ids);
  return validateProductManifest(manifest, policy);
}
export function resolvedProductPolicy(policy: ObservationPolicy, value: unknown): ObservationPolicy {
  if ((policy.resource !== "listing_details" && policy.resource !== "catalog_items" && policy.resource !== "pricing") || !policy.discovery) return policy;
  const m = validateProductManifest(value, policy);
  return policy.resource === "listing_details" ? { ...policy, sellerSkus: m.ids } : { ...policy, asins: m.ids };
}
