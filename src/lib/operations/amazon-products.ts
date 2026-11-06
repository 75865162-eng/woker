import { amazonDataAccess, sellerAccessWhere, sourceAccessWhere } from "@/lib/amazon-sync/data-access";
import { publishedSnapshotScopes, catalogPublishedWhere, inventoryPublishedWhere } from "@/lib/amazon-sync/read";
import { prisma } from "@/lib/db/prisma";
import { inventorySnapshotStatus } from "./readiness";

export type AmazonProductReadRow = {
  sellerAccountId: string; marketplaceId: string; sellerSku: string; asin: string | null;
  title?: string | null; thumbnailUrl?: string | null;
  listingStatus: string | null; available: number | null; inbound: number | null;
  reserved: number | null; unfulfillable: number | null;
  catalogUpdatedAt: string | null; inventoryUpdatedAt: string | null;
  inventoryRunId: string | null;
  freshness: "FRESH" | "STALE" | "NOT_SYNCED";
  fieldSources: Record<string, string>; lastError: string | null;
};
export const amazonProductKey = (row: { sellerAccountId: string; marketplaceId: string; sellerSku: string }) => JSON.stringify([row.sellerAccountId, row.marketplaceId, row.sellerSku]);

/** Page-bounded database projection. No Amazon requests, no ProductRecord writes. */
export async function readAmazonProductsForSkus(organizationId: string, workspaceId: string, skus: string[], actor?: string, target?: { sellerAccountId: string; marketplaceId: string }, includeCatalogDetails = false): Promise<AmazonProductReadRow[]> {
  if (!skus.length) return [];
  if (skus.length > 200) throw new Error("一次最多关联 200 个 SKU。");
  const scope = { organizationId, workspaceId };
  const allowed = sellerAccessWhere(await amazonDataAccess(scope, actor));
  const [catalogHeads, inventoryHeads, attempts] = await Promise.all([
    publishedSnapshotScopes(scope, "catalog", actor, target),
    publishedSnapshotScopes(scope, "inventory", actor, target),
    prisma.amazonSyncRun.findMany({ where: { ...scope, source: { AND: [allowed, target ?? {}] }, executionVersion: 2, resource: { in: ["inventory", "catalog"] } }, orderBy: { startedAt: "desc" }, distinct: ["sourceId"], take: 200, include: { source: { select: { sellerAccountId: true, marketplaceId: true } } } }),
  ]);
  const [catalog, inventory] = await Promise.all([
    catalogHeads.length ? prisma.amazonCatalogSnapshot.findMany({ where: { ...catalogPublishedWhere(scope, catalogHeads), sellerSku: { in: skus } }, take: 4001 }) : [],
    inventoryHeads.length ? prisma.amazonInventorySnapshot.findMany({ where: { ...inventoryPublishedWhere(scope, inventoryHeads), sellerAccountId: { not: null }, sellerSku: { in: skus } }, take: 4001 }) : [],
  ]);
  if (catalog.length > 4000 || inventory.length > 4000) throw new Error("店铺快照关联超出单页安全上限，请缩小 SKU 范围。");
  const rows = new Map<string, AmazonProductReadRow>();
  const ensure = (row: { sellerAccountId: string; marketplaceId: string; sellerSku: string }) => {
    const key = amazonProductKey(row);
    if (!rows.has(key)) rows.set(key, { sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, sellerSku: row.sellerSku, asin: null, listingStatus: null, available: null, inbound: null, reserved: null, unfulfillable: null, catalogUpdatedAt: null, inventoryUpdatedAt: null, inventoryRunId: null, freshness: "NOT_SYNCED", fieldSources: {}, lastError: attempts.filter(t => t.source?.sellerAccountId === row.sellerAccountId && t.source?.marketplaceId === row.marketplaceId && ["FAILED", "BLOCKED"].includes(t.status)).map(t => t.error).filter(Boolean).join("；") || null });
    return rows.get(key)!;
  };
  for (const row of catalog) {
    const result = ensure(row);
    result.asin = row.asin || null; result.listingStatus = row.listingStatus;
    result.catalogUpdatedAt = row.capturedAt.toISOString();
    result.fieldSources = { ...result.fieldSources, sellerSku: "Amazon Listings Items API", asin: "Amazon Listings Items API", listingStatus: "Amazon Listings Items API" };
  }
  for (const row of inventory) {
    const result = ensure({ ...row, sellerAccountId: row.sellerAccountId! });
    if (!result.asin && row.asin) { result.asin = row.asin; result.fieldSources.asin = "Amazon SP-API FBA Inventory Summaries"; }
    result.available = (result.available ?? 0) + row.fulfillableQuantity;
    result.inbound = (result.inbound ?? 0) + row.inboundWorkingQuantity + row.inboundShippedQuantity + row.inboundReceivingQuantity;
    result.reserved = (result.reserved ?? 0) + row.reservedQuantity;
    result.unfulfillable = (result.unfulfillable ?? 0) + row.unfulfillableQuantity;
    result.inventoryUpdatedAt = row.capturedAt.toISOString();
    result.inventoryRunId = row.syncRunId;
    const head = inventoryHeads.find(h => h.runId === row.syncRunId);
    result.freshness = inventorySnapshotStatus(head?.capturedAt ?? row.capturedAt, new Date(), head?.freshnessMinutes);
    result.fieldSources = { ...result.fieldSources, available: "Amazon SP-API FBA Inventory Summaries", inbound: "Amazon SP-API FBA Inventory Summaries", reserved: "Amazon SP-API FBA Inventory Summaries", unfulfillable: "Amazon SP-API FBA Inventory Summaries" };
  }
  if (includeCatalogDetails) {
    const asins = [...new Set([...rows.values()].map(row => row.asin).filter((asin): asin is string => !!asin))];
    if (asins.length) {
      const catalogRows = [...rows.values()];
      const catalogSources = await prisma.amazonSyncDataSource.findMany({
        where: {
          ...scope,
          ...sourceAccessWhere(await amazonDataAccess(scope, actor)),
          resource: "catalog_items",
          enabled: true,
          activeRunId: { not: null },
          sellerAccountId: { in: [...new Set(catalogRows.map(row => row.sellerAccountId))] },
          marketplaceId: { in: [...new Set(catalogRows.map(row => row.marketplaceId))] },
          publishedRun: { status: "SUCCEEDED", resource: "catalog_items", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } },
        },
        select: { id: true, activeRunId: true, sellerAccountId: true, marketplaceId: true },
        take: 200,
      });
      if (catalogSources.length) {
        const observations = await prisma.amazonDomainObservation.findMany({
          where: { ...scope, sourceId: { in: catalogSources.map(source => source.id) }, sourceRunId: { in: catalogSources.map(source => source.activeRunId!) }, kind: "CATALOG_DETAIL", asin: { in: asins } },
          select: { sourceId: true, asin: true, facts: true },
          take: 400,
        });
        for (const observation of observations) {
          const source = catalogSources.find(candidate => candidate.id === observation.sourceId);
          if (!source || !observation.asin) continue;
          const facts = observation.facts as { summaries?: Array<{ marketplaceId?: string; itemName?: string }>; images?: Array<{ marketplaceId?: string; images?: Array<{ variant?: string; link?: string; width?: number; height?: number }> }> };
          const summary = facts.summaries?.find(item => item.marketplaceId === source.marketplaceId);
          const images = facts.images?.find(item => item.marketplaceId === source.marketplaceId)?.images ?? [];
          const mainImage = images.filter(image => image.variant === "MAIN" && typeof image.link === "string").sort((a, b) => (a.width ?? Infinity) * (a.height ?? Infinity) - (b.width ?? Infinity) * (b.height ?? Infinity))[0];
          let thumbnailUrl: string | null = null;
          try {
            const url = new URL(mainImage?.link ?? "");
            if (url.protocol === "https:" && url.hostname === "m.media-amazon.com") thumbnailUrl = url.toString();
          } catch { /* Missing or invalid image metadata stays empty. */ }
          for (const row of catalogRows.filter(candidate => candidate.asin === observation.asin && candidate.sellerAccountId === source.sellerAccountId && candidate.marketplaceId === source.marketplaceId)) {
            row.title = summary?.itemName ?? null;
            row.thumbnailUrl = thumbnailUrl;
            row.fieldSources = { ...row.fieldSources, ...(row.title ? { title: "Amazon Catalog Items API" } : {}), ...(row.thumbnailUrl ? { thumbnailUrl: "Amazon Catalog Items API" } : {}) };
          }
        }
      }
    }
  }
  return [...rows.values()];
}
