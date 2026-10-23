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
  if (!isRecord(value)) throw new Error("Amazon 库存响应格式无效。");
  const response = isRecord(value.payload) ? value.payload : value;
  if (!Array.isArray(response.inventorySummaries)) throw new Error("Amazon 库存响应缺少 inventorySummaries，不能视为空快照成功。");
  const seen = new Set<string>();
  const snapshots: AmazonInventorySnapshotInput[] = [];

  for (const item of response.inventorySummaries) {
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
      fulfillableQuantity: inventoryQuantity(details.fulfillableQuantity),
      inboundWorkingQuantity: inventoryQuantity(details.inboundWorkingQuantity),
      inboundShippedQuantity: inventoryQuantity(details.inboundShippedQuantity),
      inboundReceivingQuantity: inventoryQuantity(details.inboundReceivingQuantity),
      reservedQuantity: inventoryQuantity(isRecord(details.reservedQuantity) ? details.reservedQuantity.totalReservedQuantity : details.reservedQuantity),
      unfulfillableQuantity: inventoryQuantity(isRecord(details.unfulfillableQuantity) ? details.unfulfillableQuantity.totalUnfulfillableQuantity : details.unfulfillableQuantity),
      researchingQuantity: inventoryQuantity(isRecord(details.researchingQuantity) ? details.researchingQuantity.totalResearchingQuantity : details.researchingQuantity),
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

function inventoryQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Amazon 库存数量缺失或无效，不能补零保存；请检查授权、响应字段并重新同步。");
  }
  return value;
}
