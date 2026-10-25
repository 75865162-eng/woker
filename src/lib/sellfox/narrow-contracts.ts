import { SellfoxSyncInputError } from "./sync-contract";
export type SellfoxRow = Record<string, unknown>;
export function sellfoxNumber(row: SellfoxRow, key: string, integer = false): number | null {
  const value = row[key];
  if (value === undefined || value === null || value === "") return null;
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value)) || (integer && !Number.isSafeInteger(Number(value)))) throw new SellfoxSyncInputError(`赛狐 ${key} 数值无效。`);
  return Number(value);
}
export function sellfoxText(row: SellfoxRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
/** Verified inventory response 2026-10-25. quantity remains API available; absent is null. */
export function inventoryNarrow(row: SellfoxRow) {
  return {
    totalInventory: sellfoxNumber(row, "totalInventory", true), inTransit: sellfoxNumber(row, "inTransit", true),
    inboundWorking: sellfoxNumber(row, "inboundWorking", true), inboundShipped: sellfoxNumber(row, "inboundShipped", true), inboundReceiving: sellfoxNumber(row, "inboundReceiving", true),
    reservedTransfer: sellfoxNumber(row, "reservedTransfer", true), reservedProcessing: sellfoxNumber(row, "reservedProcessing", true), reservedCustomerorders: sellfoxNumber(row, "reservedCustomerorders", true),
    unfulfillable: sellfoxNumber(row, "unfulfillable", true), warehouseName: sellfoxText(row, "warehouseName"), commodityName: sellfoxText(row, "commodityName"), currency: sellfoxText(row, "currency"),
    avgInventoryCost: sellfoxNumber(row, "avgInventoryCost"), avgTransportCost: sellfoxNumber(row, "avgTransportCost"),
  };
}
/** V2 response verified 2026-10-25: sku is Amazon MSKU, commoditySku is internal SKU. */
export function listingNarrow(row: SellfoxRow, shop: string) {
  const sourceKey = sellfoxText(row, "id"), msku = sellfoxText(row, "sku"), asin = sellfoxText(row, "asin");
  const status = sellfoxText(row, "onlineStatus");
  // Real V2 deleted row (2026-10-25) has stable id + ASIN but an empty sku. Preserve missing MSKU as null.
  if (row.shopId !== shop || !sourceKey || !asin || (!msku && status?.toLowerCase() !== "delete")) throw new SellfoxSyncInputError("Listing 缺少稳定身份或店铺归属不匹配。");
  const inventory = row.inventoryManage;
  if (inventory !== null && inventory !== undefined && (typeof inventory !== "object" || Array.isArray(inventory))) throw new SellfoxSyncInputError("Listing 库存结构无效。");
  // quantity is listing quantity; only nested inventory.available is verified FBA fulfillable.
  return { sourceKey, msku, asin, sku: sellfoxText(row, "commoditySku") ?? "", parentAsin: sellfoxText(row, "parentAsin"), title: sellfoxText(row, "title"), status,
    price: sellfoxNumber(row, "standardPrice"), currency: sellfoxText(row, "currency"), fulfillable: inventory ? sellfoxNumber(inventory as SellfoxRow, "available", true) : null,
    sales7: sellfoxNumber(row, "day7SaleNum", true), sales14: sellfoxNumber(row, "day14SaleNum", true), sales30: sellfoxNumber(row, "day30SaleNum", true),
    revenue7: sellfoxNumber(row, "day7SalePrice"), revenue14: sellfoxNumber(row, "day14SalePrice"), revenue30: sellfoxNumber(row, "day30SalePrice"),
    adSpend7: sellfoxNumber(row, "day7AdTotalCost"), adSpend14: sellfoxNumber(row, "day14AdTotalCost"), adSpend30: sellfoxNumber(row, "day30AdTotalCost"), sourceUpdatedAt: sellfoxText(row, "lastSyncTime") };
}
