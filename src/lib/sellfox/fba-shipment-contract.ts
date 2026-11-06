import { Prisma } from "@prisma/client";
import { sellfoxNumber, sellfoxText, type SellfoxRow } from "./narrow-contracts";
import { SellfoxSyncInputError } from "./sync-contract";

export const sellfoxFbaShipmentStatuses = ["WORKING", "READY_TO_SHIP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING", "CLOSED", "CANCELLED", "DELETED"] as const;
export type SellfoxFbaShipmentStatus = (typeof sellfoxFbaShipmentStatuses)[number];
export const sellfoxInTransitStatuses: readonly SellfoxFbaShipmentStatus[] = ["SHIPPED", "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING"];

const statusAliases: Record<string, SellfoxFbaShipmentStatus> = {
  "1": "WORKING",
  "2": "READY_TO_SHIP",
  "3": "SHIPPED",
  "-1": "CANCELLED",
  WORKING: "WORKING",
  READY_TO_SHIP: "READY_TO_SHIP",
  SHIPPED: "SHIPPED",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  CHECKED_IN: "CHECKED_IN",
  RECEIVING: "RECEIVING",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  DELETED: "DELETED",
};

export function sellfoxFbaShipmentStatus(value: unknown): SellfoxFbaShipmentStatus {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
  const status = statusAliases[text];
  if (!status) throw new SellfoxSyncInputError("货件状态无法识别，未写入。");
  return status;
}

export type SellfoxFbaShipmentLine = {
  shipmentId: string;
  shipmentName: string | null;
  status: SellfoxFbaShipmentStatus;
  lineKey: string;
  asin: string;
  msku: string;
  sku: string;
  declaredQty: number | null;
  shippedQty: number | null;
  receivedQty: number | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  shippedAt: string | null;
  fulfillmentCenterId: string | null;
  payload: Prisma.InputJsonValue;
};

function record(value: unknown, message: string): SellfoxRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SellfoxSyncInputError(message);
  return value as SellfoxRow;
}

/**
 * Verified list path is `/api/fba/shippingOrder/pageList.json`.
 * Shipping-order codes 1/2/3/-1 map to WORKING/READY_TO_SHIP/SHIPPED/CANCELLED.
 * Amazon inbound names are kept when the payload already uses them.
 * Quantity keys are declaredQty / shippedQty / receivedQty; absent stays null.
 */
export function sellfoxFbaShipmentLines(value: unknown, shopExternalId: string): SellfoxFbaShipmentLine[] {
  const row = record(value, "货件响应记录无效。");
  if (String(row.shopId ?? "") !== shopExternalId) throw new SellfoxSyncInputError("货件响应店铺归属不匹配，已拒绝写入。");
  const shipmentId = sellfoxText(row, "shipSn") ?? sellfoxText(row, "amazonShipmentId");
  if (!shipmentId) throw new SellfoxSyncInputError("货件响应缺少 shipSn 或 amazonShipmentId。");
  const status = sellfoxFbaShipmentStatus(row.status);
  const header = {
    shipmentId,
    shipmentName: sellfoxText(row, "shipmentName"),
    status,
    sourceCreatedAt: sellfoxText(row, "createTime"),
    sourceUpdatedAt: sellfoxText(row, "updateTime"),
    shippedAt: sellfoxText(row, "shipTime"),
    fulfillmentCenterId: sellfoxText(row, "fulfillmentCenterId"),
  };
  if (!Array.isArray(row.items)) throw new SellfoxSyncInputError("货件响应缺少商品行 items。");
  const lines = row.items.map((itemValue) => {
    const item = record(itemValue, "货件商品行无效。");
    const lineKey = sellfoxText(item, "id") ?? sellfoxText(item, "sellerSku") ?? sellfoxText(item, "msku");
    const msku = sellfoxText(item, "msku") ?? sellfoxText(item, "sellerSku") ?? "";
    const asin = sellfoxText(item, "asin") ?? "";
    const sku = sellfoxText(item, "commoditySku") ?? sellfoxText(item, "sku") ?? "";
    if (!lineKey || (!asin && !msku && !sku)) throw new SellfoxSyncInputError("货件商品行缺少身份。");
    return {
      ...header,
      lineKey,
      asin,
      msku,
      sku,
      declaredQty: sellfoxNumber(item, "declaredQty", true),
      shippedQty: sellfoxNumber(item, "shippedQty", true),
      receivedQty: sellfoxNumber(item, "receivedQty", true),
      payload: { shipment: row, item } as Prisma.InputJsonValue,
    };
  });
  if (new Set(lines.map((line) => line.lineKey)).size !== lines.length) throw new SellfoxSyncInputError("货件商品行身份重复。");
  return lines;
}
