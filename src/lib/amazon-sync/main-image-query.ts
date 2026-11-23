import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonImageUrl, extractAmazonMainImage } from "./catalog-images";
import type { AmazonDataAccess } from "./data-access";
import { sourceAccessWhere } from "./data-access";
import type { SyncScope } from "./policy";

type Scope = SyncScope;
export type ImageProduct = { sellerAccountId: string; marketplaceId: string; asin: string };
const MAX_PRODUCTS = 2000;

/**
 * Resolve SP-API catalog main-image URLs for a batch of ASINs from already-published
 * domain observations. Never fabricates a URL: only whitelisted m.media-amazon.com
 * links extracted from CATALOG_DETAIL / LISTING_DETAIL facts are returned.
 * CATALOG_DETAIL wins over LISTING_DETAIL for the same (seller, marketplace, asin).
 * Tenant / workspace / seller boundaries are enforced through the source relation.
 */
export async function readMainImageUrlsByAsins(
  scope: Scope,
  access: AmazonDataAccess,
  products: ImageProduct[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const valid = products.filter((p) => p && /^[A-Z0-9]{10}$/.test(p.asin || "") && p.sellerAccountId && p.marketplaceId);
  if (!valid.length) return result;
  if (valid.length > MAX_PRODUCTS) throw new Error("IMAGE_PRODUCT_SCOPE_EXCEEDS_LIMIT");
  const deduped = [...new Map(valid.map((p) => [`${p.sellerAccountId}|${p.marketplaceId}|${p.asin}`, p])).values()];

  // Keep seller/marketplace authorization and the requested target tuples in separate
  // AND clauses so a scopes-level OR from sourceAccessWhere cannot be overwritten.
  const sources = await prisma.amazonSyncDataSource.findMany({
    where: {
      ...scope,
      resource: { in: ["catalog_items", "listing_details"] },
      AND: [
        sourceAccessWhere(access),
        { OR: deduped.map((p) => ({ sellerAccountId: p.sellerAccountId, marketplaceId: p.marketplaceId })) },
      ],
    },
    select: { id: true, sellerAccountId: true, marketplaceId: true, resource: true, activeRunId: true },
    take: 500,
  });
  if (!sources.length) return result;

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const publishedSources = sources.filter((s) => s.activeRunId);
  if (!publishedSources.length) return result;

  const rows = await prisma.amazonDomainObservation.findMany({
    where: {
      ...scope,
      kind: { in: ["CATALOG_DETAIL", "LISTING_DETAIL"] },
      asin: { in: [...new Set(deduped.map((p) => p.asin))] },
      sourceId: { in: publishedSources.map((s) => s.id) },
      sourceRunId: { in: [...new Set(publishedSources.map((s) => s.activeRunId!))] },
    },
    select: { sourceId: true, sourceRunId: true, kind: true, asin: true, facts: true, capturedAt: true },
    orderBy: [{ capturedAt: "desc" }],
    take: 8000,
  });

  // Rank: CATALOG_DETAIL (catalog_items) first, then LISTING_DETAIL; newest capture first.
  const rank = (kind: string) => (kind === "CATALOG_DETAIL" ? 0 : 1);
  const sorted = [...rows].sort((a, b) => rank(a.kind) - rank(b.kind) || b.capturedAt.getTime() - a.capturedAt.getTime());
  for (const row of sorted) {
    if (!row.asin) continue;
    const source = sourceById.get(row.sourceId);
    if (!source || source.activeRunId !== row.sourceRunId) continue;
    const resource = source.resource === "catalog_items" ? "catalog_items" : "listing_details";
    const image = extractAmazonMainImage({ asin: row.asin, sellerSku: null, facts: row.facts }, source.marketplaceId, resource);
    if (!image || !amazonImageUrl(image.sourceUrl)) continue;
    const key = `${source.sellerAccountId}|${source.marketplaceId}|${row.asin}`;
    if (!result.has(key)) result.set(key, image.sourceUrl);
  }
  return result;
}

/**
 * Loose variant: resolve main-image URLs by ASIN alone within every catalog source
 * visible to the caller. Used by pages whose rows expose only an ASIN (no seller/site).
 * Returns Map<asin, url>. Catalog source wins over listing across all sites.
 */
export async function readMainImageUrlsByAsinOnly(
  scope: Scope,
  access: AmazonDataAccess,
  asins: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const valid = [...new Set(asins.filter((a) => typeof a === "string" && /^[A-Z0-9]{10}$/.test(a)))];
  if (!valid.length) return result;
  if (valid.length > MAX_PRODUCTS) throw new Error("IMAGE_PRODUCT_SCOPE_EXCEEDS_LIMIT");

  const sources = await prisma.amazonSyncDataSource.findMany({
    where: {
      ...scope,
      resource: { in: ["catalog_items", "listing_details"] },
      AND: [sourceAccessWhere(access)],
      activeRunId: { not: null },
    },
    select: { id: true, sellerAccountId: true, marketplaceId: true, resource: true, activeRunId: true },
    take: 500,
  });
  if (!sources.length) return result;
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const rows = await prisma.amazonDomainObservation.findMany({
    where: {
      ...scope,
      kind: { in: ["CATALOG_DETAIL", "LISTING_DETAIL"] },
      asin: { in: valid },
      sourceId: { in: sources.map((s) => s.id) },
      sourceRunId: { in: [...new Set(sources.map((s) => s.activeRunId!))] },
    },
    select: { sourceId: true, sourceRunId: true, kind: true, asin: true, facts: true, capturedAt: true },
    orderBy: [{ capturedAt: "desc" }],
    take: 8000,
  });
  const rank = (kind: string) => (kind === "CATALOG_DETAIL" ? 0 : 1);
  const sorted = [...rows].sort((a, b) => rank(a.kind) - rank(b.kind) || b.capturedAt.getTime() - a.capturedAt.getTime());
  for (const row of sorted) {
    if (!row.asin || result.has(row.asin)) continue;
    const source = sourceById.get(row.sourceId);
    if (!source || source.activeRunId !== row.sourceRunId) continue;
    const resource = source.resource === "catalog_items" ? "catalog_items" : "listing_details";
    const image = extractAmazonMainImage({ asin: row.asin, sellerSku: null, facts: row.facts }, source.marketplaceId, resource);
    if (!image || !amazonImageUrl(image.sourceUrl)) continue;
    result.set(row.asin, image.sourceUrl);
  }
  return result;
}

export function imageKey(sellerAccountId: string, marketplaceId: string, asin: string): string {
  return `${sellerAccountId}|${marketplaceId}|${asin}`;
}
