import { prisma } from "@/lib/db/prisma";
import { inventorySnapshotStatus } from "./readiness";

export type AmazonProductReadRow = {
  sellerAccountId: string; marketplaceId: string; sellerSku: string; asin: string | null;
  listingStatus: string | null; available: number | null; inbound: number | null;
  reserved: number | null; unfulfillable: number | null;
  catalogUpdatedAt: string | null; inventoryUpdatedAt: string | null;
  inventoryRunId: string | null;
  freshness: "FRESH" | "STALE" | "NOT_SYNCED";
  fieldSources: Record<string, string>; lastError: string | null;
};
export const amazonProductKey = (row: { sellerAccountId: string; marketplaceId: string; sellerSku: string }) => JSON.stringify([row.sellerAccountId, row.marketplaceId, row.sellerSku]);

/** Page-bounded database projection. No Amazon requests, no ProductRecord writes. */
export async function readAmazonProductsForSkus(organizationId: string, workspaceId: string, skus: string[]): Promise<AmazonProductReadRow[]> {
  if (!skus.length) return [];
  if (skus.length > 200) throw new Error("一次最多关联 200 个 SKU。");
  const scope = { organizationId, workspaceId };
  const [catalogRun, inventoryRun, attempts] = await Promise.all([
    prisma.amazonSyncRun.findFirst({ where: { ...scope, resource: "catalog", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    prisma.amazonSyncRun.findFirst({ where: { ...scope, resource: "inventory", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    prisma.amazonSyncRun.findMany({ where: { ...scope, resource: { in: ["inventory", "catalog"] } }, orderBy: { startedAt: "desc" }, distinct: ["resource"], take: 2 }),
  ]);
  const [catalog, inventory] = await Promise.all([
    catalogRun ? prisma.amazonCatalogSnapshot.findMany({ where: { ...scope, sourceRunId: catalogRun.id, sellerSku: { in: skus } }, take: 4001 }) : [],
    inventoryRun ? prisma.amazonInventorySnapshot.findMany({ where: { ...scope, syncRunId: inventoryRun.id, sellerAccountId: { not: null }, sellerSku: { in: skus } }, take: 4001 }) : [],
  ]);
  if (catalog.length > 4000 || inventory.length > 4000) throw new Error("店铺快照关联超出单页安全上限，请缩小 SKU 范围。");
  const lastError = attempts.filter((row) => row.status === "FAILED" || row.status === "BLOCKED").map((row) => `${row.resource}: ${row.error ?? "同步失败"}`).join("；") || null;
  const rows = new Map<string, AmazonProductReadRow>();
  const ensure = (row: { sellerAccountId: string; marketplaceId: string; sellerSku: string }) => {
    const key = amazonProductKey(row);
    if (!rows.has(key)) rows.set(key, { sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId, sellerSku: row.sellerSku, asin: null, listingStatus: null, available: null, inbound: null, reserved: null, unfulfillable: null, catalogUpdatedAt: null, inventoryUpdatedAt: null, inventoryRunId: null, freshness: "NOT_SYNCED", fieldSources: {}, lastError });
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
    result.freshness = inventorySnapshotStatus(row.capturedAt);
    result.fieldSources = { ...result.fieldSources, available: "Amazon SP-API FBA Inventory Summaries", inbound: "Amazon SP-API FBA Inventory Summaries", reserved: "Amazon SP-API FBA Inventory Summaries", unfulfillable: "Amazon SP-API FBA Inventory Summaries" };
  }
  return [...rows.values()];
}
