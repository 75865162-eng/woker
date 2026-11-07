import { amazonDataAccess, sellerAccessWhere, sourceAccessWhere } from "@/lib/amazon-sync/data-access";
import { extractAmazonProductTitle } from "@/lib/amazon-sync/catalog-images";
import { publishedSnapshotScopes, catalogPublishedWhere, inventoryPublishedWhere } from "@/lib/amazon-sync/read";
import { prisma } from "@/lib/db/prisma";
import { inventorySnapshotStatus } from "./readiness";
import { readProductImageReferences } from "./amazon-product-images";

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
    const productRows = [...rows.values()].filter(row => row.asin);
    if (productRows.length) {
      const access = await amazonDataAccess(scope, actor);
      const sources = await prisma.amazonSyncDataSource.findMany({
        where: { ...scope, ...sourceAccessWhere(access), resource: { in: ["catalog_items", "listing_details"] }, enabled: true, activeRunId: { not: null }, sellerAccountId: { in: [...new Set(productRows.map(row => row.sellerAccountId))] }, marketplaceId: { in: [...new Set(productRows.map(row => row.marketplaceId))] }, publishedRun: { status: "SUCCEEDED", executionVersion: 2, finishedAt: { not: null }, stage: { not: "PURGED" } } },
        select: { id: true, resource: true, activeRunId: true, sellerAccountId: true, marketplaceId: true }, take: 200,
      });
      const asins = [...new Set(productRows.map(row => row.asin!))];
      const observations = sources.length ? await prisma.amazonDomainObservation.findMany({ where: { ...scope, OR: sources.map(source => ({ sourceId: source.id, sourceRunId: source.activeRunId! })), asin: { in: asins }, kind: { in: ["CATALOG_DETAIL", "LISTING_DETAIL"] } }, select: { sourceId: true, asin: true, facts: true }, take: 4000 }) : [];
      const sourceById = new Map(sources.map(source => [source.id, source]));
      const detailsByProduct = new Map<string, { title: string | null; titleResource: string }>();
      for (const observation of observations) {
        if (!observation.asin) continue;
        const source = sourceById.get(observation.sourceId);
        if (!source || (source.resource !== "catalog_items" && source.resource !== "listing_details")) continue;
        const key = JSON.stringify([source.sellerAccountId, source.marketplaceId, observation.asin]);
        const previous = detailsByProduct.get(key);
        const title = extractAmazonProductTitle(observation.facts, source.marketplaceId);
        const preferred = source.resource === "catalog_items";
        detailsByProduct.set(key, {
          title: title && (!previous?.title || preferred) ? title : previous?.title ?? null,
          titleResource: title && (!previous?.title || preferred) ? source.resource : previous?.titleResource ?? source.resource,
        });
      }
      for (const row of productRows) {
        const detail = detailsByProduct.get(JSON.stringify([row.sellerAccountId, row.marketplaceId, row.asin]));
        if (detail) {
          row.title = detail.title;
          row.fieldSources = { ...row.fieldSources, ...(row.title ? { title: detail.titleResource === "catalog_items" ? "Amazon Catalog Items API" : "Amazon Listings Items API" } : {}) };
        }
      }
      const uniqueProducts = [...new Map(productRows.map(row => [JSON.stringify([row.sellerAccountId, row.marketplaceId, row.asin]), row])).values()];
      const imageReferences = await readProductImageReferences(scope, uniqueProducts.map(row => ({ sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, asin: row.asin! })));
      const imageByProduct = new Map(imageReferences.map(image => [JSON.stringify([image.sellerAccountId, image.marketplaceId, image.asin]), image]));
      for (const row of productRows) {
        const image = imageByProduct.get(JSON.stringify([row.sellerAccountId, row.marketplaceId, row.asin]));
        if (image) {
          row.thumbnailUrl = `/api/operations/products/images/${encodeURIComponent(image.fileId)}?workspaceId=${encodeURIComponent(workspaceId)}`;
          row.fieldSources = { ...row.fieldSources, thumbnailUrl: "本地持久化 Amazon 主图" };
        }
      }
    }
  }
  return [...rows.values()];
}
