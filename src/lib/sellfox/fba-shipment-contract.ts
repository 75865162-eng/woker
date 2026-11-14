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
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  // 先按原值查（"-1" 这类负数码会被下划线归一化破坏），再查归一化值（"in transit" → IN_TRANSIT）。
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const status = statusAliases[raw] ?? statusAliases[normalized];
  // 只回显枚举取值（截断 24 字），不回显货件正文，便于定位未覆盖的状态码。
  if (!status) throw new SellfoxSyncInputError(`货件状态无法识别（${raw.slice(0, 24) || "空"}），未写入。`);
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

/** 同一货件同 SKU 多行合并：两侧都为 null 才保持 null，否则按 0 起算求和。 */
function sumQuantity(left: number | null | undefined, right: number | null): number | null {
  if ((left ?? null) === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

export type SellfoxFbaShipmentHeader = {
  shipmentId: string;
  shipmentName: string | null;
  status: SellfoxFbaShipmentStatus;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  shippedAt: string | null;
  fulfillmentCenterId: string | null;
  expectedLineCount: number;
};

/**
 * 实测（2026-11-14）`POST /api/fba/shippingOrder/pageList.json` 的头行**不含 shopId、不含 items**：
 * 只有 shippingOrderId / shipSn / status / createTime / updateTime / shipTime / itemTotalSize / fulfilmentIds / logistics[]。
 * 因此头行不再做店铺归属校验，店铺归属由批量商品行的 shopId 校验（见 sellfoxFbaShipmentLines）。
 * 状态码 1/2/3/-1 映射 WORKING/READY_TO_SHIP/SHIPPED/CANCELLED。
 */
export function sellfoxFbaShipmentHeader(value: unknown): SellfoxFbaShipmentHeader {
  const row = record(value, "货件响应记录无效。");
  const shipmentId = sellfoxText(row, "shipSn") ?? sellfoxText(row, "amazonShipmentId");
  if (!shipmentId) throw new SellfoxSyncInputError("货件响应缺少 shipSn 或 amazonShipmentId。");
  const expectedLineCount = Number(row.itemTotalSize ?? 0);
  return {
    shipmentId,
    shipmentName: sellfoxText(row, "shipmentName"),
    status: sellfoxFbaShipmentStatus(row.status),
    sourceCreatedAt: sellfoxText(row, "createTime"),
    sourceUpdatedAt: sellfoxText(row, "updateTime"),
    shippedAt: sellfoxText(row, "shipTime"),
    fulfillmentCenterId: sellfoxText(row, "fulfillmentCenterId") ?? sellfoxText(row, "warehouseId"),
    expectedLineCount: Number.isSafeInteger(expectedLineCount) && expectedLineCount > 0 ? expectedLineCount : 0,
  };
}

/**
 * 实测 `POST /api/fba/shippingOrder/itemsBatch.json`（body `{ shipSnList: [...] }`）返回
 * `[{ shipSn, items: [...] }]`；商品行带 shopId / asin / sellerSku / fnSku / quantity / shipCount / quantityReceived / shipmentStatus。
 * 数量口径：quantity→declaredQty，shipCount→shippedQty，quantityReceived→receivedQty，缺字段保持 null。
 * 同一货件内同一 SKU 可能出现多行（实测 FH11813300867 同 SKU 20 件 + 10 件），按身份合并求和，避免行身份冲突。
 */
export function sellfoxFbaShipmentLines(header: SellfoxFbaShipmentHeader, value: unknown, shopExternalId: string): SellfoxFbaShipmentLine[] {
  const group = record(value, "货件商品批量响应记录无效。");
  if (String(group.shipSn ?? "") !== header.shipmentId) throw new SellfoxSyncInputError("货件商品响应与发货单不匹配，已拒绝写入。");
  if (!Array.isArray(group.items)) throw new SellfoxSyncInputError("货件商品批量响应缺少 items。");
  if (header.expectedLineCount > 0 && group.items.length === 0) throw new SellfoxSyncInputError("货件商品明细缺失，已拒绝写入。");
  const merged = new Map<string, SellfoxFbaShipmentLine>();
  for (const itemValue of group.items) {
    const item = record(itemValue, "货件商品行无效。");
    if (String(item.shopId ?? "") !== shopExternalId) throw new SellfoxSyncInputError("货件商品行店铺归属不匹配，已拒绝写入。");
    const asin = sellfoxText(item, "asin") ?? "";
    const msku = sellfoxText(item, "sellerSku") ?? sellfoxText(item, "msku") ?? "";
    const sku = sellfoxText(item, "commoditySku") ?? sellfoxText(item, "sku") ?? "";
    const fnSku = sellfoxText(item, "fnSku") ?? "";
    const lineKey = [asin, msku, sku, fnSku].join("|");
    if (!asin && !msku && !sku) throw new SellfoxSyncInputError("货件商品行缺少身份。");
    // 商品行自带的 shipmentStatus 是亚马逊入库计划状态（如 SHIPPED）；缺失时回落到发货单状态。
    const status = sellfoxText(item, "shipmentStatus") ? sellfoxFbaShipmentStatus(item.shipmentStatus) : header.status;
    const previous = merged.get(lineKey);
    merged.set(lineKey, {
      shipmentId: header.shipmentId,
      shipmentName: header.shipmentName,
      status: previous?.status ?? status,
      lineKey,
      asin,
      msku,
      sku,
      declaredQty: sumQuantity(previous?.declaredQty, sellfoxNumber(item, "quantity", true) ?? sellfoxNumber(item, "declaredQty", true)),
      shippedQty: sumQuantity(previous?.shippedQty, sellfoxNumber(item, "shipCount", true) ?? sellfoxNumber(item, "shippedQty", true)),
      receivedQty: sumQuantity(previous?.receivedQty, sellfoxNumber(item, "quantityReceived", true) ?? sellfoxNumber(item, "receivedQty", true)),
      sourceCreatedAt: header.sourceCreatedAt,
      sourceUpdatedAt: header.sourceUpdatedAt,
      shippedAt: header.shippedAt,
      fulfillmentCenterId: header.fulfillmentCenterId,
      payload: { shipment: { shipSn: header.shipmentId, status: header.status, createTime: header.sourceCreatedAt }, item } as Prisma.InputJsonValue,
    });
  }
  return [...merged.values()];
}
