import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SyncInputError, type SyncScope } from "./policy";
import type { ListingDetailPolicy, CatalogDetailPolicy, ObservationPolicy } from "./observation-policy";
type ProductPolicy = ListingDetailPolicy | CatalogDetailPolicy;
type Source = { id: string; authorizationId: string; sellerAccountId: string; marketplaceId: string; authorization: { revision: number; amazonSellerId: string } };
export type ProductManifest = { sourceId: string; sourceRevision: number; runId: string; authorizationRevision: number; total: number; ids: string[]; digest: string; batchSize: 100 };
const hash = (ids: string[]) => createHash("sha256").update(JSON.stringify(ids)).digest("hex");
function rejected(): never { throw new SyncInputError("商品发现需要当前身份、授权版本一致的完整在线商品快照；快照变更或范围超预算时保留旧详情版本。", 409); }
export function validateProductManifest(value: unknown, policy: ProductPolicy): ProductManifest {
  const m = value as ProductManifest | null;
  if (!policy.discovery || !m || m.sourceId !== policy.discovery.sourceId || !Number.isSafeInteger(m.sourceRevision) || m.sourceRevision < 1 || !Number.isSafeInteger(m.authorizationRevision) || m.authorizationRevision < 1 || typeof m.runId !== "string" || !m.runId || m.batchSize !== 100 || !Array.isArray(m.ids) || !m.ids.length || m.total !== m.ids.length || m.total > policy.discovery.maxObjects || m.total > policy.maxRows || m.total > policy.maxRequests || hash(m.ids) !== m.digest) rejected();
  const pattern = policy.resource === "listing_details" ? /^[^\u0000-\u001f\u007f]{1,255}$/ : /^[A-Z0-9]{10}$/;
  if (m.ids.some(v => typeof v !== "string" || !pattern.test(v)) || new Set(m.ids).size !== m.ids.length || m.ids.some((v, i) => i > 0 && m.ids[i - 1] >= v)) rejected();
  return m;
}
export async function assertProductDiscoveryHead(tx: Prisma.TransactionClient, scope: SyncScope, source: Source, manifest: ProductManifest) {
  const upstream = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: manifest.sourceId, resource: "catalog", authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }, include: { publishedRun: true } });
  const frozen = upstream?.publishedRun?.frozenScope as Record<string, unknown> | undefined;
  const coverage = upstream?.coverage as Record<string, unknown> | null;
  if (!upstream || upstream.id === source.id || !upstream.enabled || upstream.revision !== manifest.sourceRevision || upstream.activeRunId !== manifest.runId || !upstream.publishedRun || upstream.publishedRun.status !== "SUCCEEDED" || upstream.publishedRun.stage === "PURGED" || upstream.publishedRun.executionVersion !== 2 || !upstream.publishedRun.finishedAt || coverage?.type !== "complete_snapshot" || coverage.paginationComplete !== true || frozen?.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision || !source.authorization.amazonSellerId || frozen.amazonSellerId !== source.authorization.amazonSellerId || manifest.authorizationRevision !== source.authorization.revision) rejected();
  return upstream;
}
/** Read immutable rows in batches, freeze one bounded whole-round manifest. */
export async function discoverProductObjects(tx: Prisma.TransactionClient, scope: SyncScope, source: Source, policy: ObservationPolicy): Promise<ProductManifest | undefined> {
  if (policy.resource !== "listing_details" && policy.resource !== "catalog_items" || !policy.discovery) return;
  const head = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: policy.discovery.sourceId, resource: "catalog", authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }, select: { revision: true, activeRunId: true, rowCount: true } });
  if (!head?.activeRunId || head.rowCount > 1000) rejected();
  const manifest: ProductManifest = { sourceId: policy.discovery.sourceId, sourceRevision: head.revision, runId: head.activeRunId, authorizationRevision: source.authorization.revision, total: 0, ids: [], digest: "", batchSize: 100 };
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
  if ((policy.resource !== "listing_details" && policy.resource !== "catalog_items") || !policy.discovery) return policy;
  const m = validateProductManifest(value, policy);
  return policy.resource === "listing_details" ? { ...policy, sellerSkus: m.ids } : { ...policy, asins: m.ids };
}
