import type { AmazonMarketplaceParticipation } from "@/lib/operations/types";

export type AmazonInventorySnapshotInput = {
  sellerSku: string;
  asin: string;
  fnSku: string;
  condition: string;
  fulfillableQuantity: number;
  inboundWorkingQuantity: number;
  inboundShippedQuantity: number;
  inboundReceivingQuantity: number;
  reservedQuantity: number;
  unfulfillableQuantity: number;
  researchingQuantity: number;
};

/** Extracts only the inventory fields required by the ERP snapshot contract. */
export function extractAmazonInventorySnapshots(value: unknown): AmazonInventorySnapshotInput[] {
  if (!isRecord(value) || !Array.isArray(value.inventorySummaries)) return [];
  const seen = new Set<string>();
  const snapshots: AmazonInventorySnapshotInput[] = [];

  for (const item of value.inventorySummaries) {
    if (!isRecord(item)) continue;
    const sellerSku = text(item.sellerSku);
    const condition = text(item.condition);
    const uniquenessKey = `${sellerSku}\u0000${condition}`;
    if (!sellerSku || seen.has(uniquenessKey)) continue;
    seen.add(uniquenessKey);

    const details = isRecord(item.inventoryDetails) ? item.inventoryDetails : {};
    snapshots.push({
      sellerSku,
      asin: text(item.asin),
      fnSku: text(item.fnSku),
      condition,
      fulfillableQuantity: nonNegativeInteger(details.fulfillableQuantity),
      inboundWorkingQuantity: nonNegativeInteger(details.inboundWorkingQuantity),
      inboundShippedQuantity: nonNegativeInteger(details.inboundShippedQuantity),
      inboundReceivingQuantity: nonNegativeInteger(details.inboundReceivingQuantity),
      reservedQuantity: nonNegativeInteger(details.reservedQuantity),
      unfulfillableQuantity: nonNegativeInteger(details.unfulfillableQuantity),
      researchingQuantity: nonNegativeInteger(details.researchingQuantity),
    });
  }

  return snapshots;
}

/** Resolves UI marketplace code or an explicit ID against the verified Amazon mapping. */
export function resolveAmazonMarketplaceId(marketplace: string, participations: AmazonMarketplaceParticipation[]): string {
  const normalized = marketplace.trim().toUpperCase();
  const matches = participations.filter((participation) => (
    participation.marketplaceId.toUpperCase() === normalized
    || participation.countryCode.toUpperCase() === normalized
    || participation.domainName.toUpperCase() === normalized
  ));
  if (matches.length !== 1) {
    throw new Error(matches.length ? "当前工作区站点对应多个 Amazon Marketplace，请使用明确的 Marketplace ID。" : "当前工作区站点未匹配到已验证的 Amazon Marketplace。" );
  }
  return matches[0].marketplaceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function nonNegativeInteger(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.floor(numberValue)) : 0;
}
