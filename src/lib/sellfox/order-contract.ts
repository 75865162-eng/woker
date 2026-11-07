import { Prisma } from "@prisma/client";
import { sellfoxNumber, sellfoxText, type SellfoxRow } from "./narrow-contracts";
import { SellfoxSyncInputError } from "./sync-contract";

export type SellfoxOrderLine = {
  orderId: string;
  lineKey: string;
  sellerOrderId: string | null;
  asin: string;
  msku: string;
  sku: string;
  orderStatus: string;
  purchaseDate: string | null;
  purchaseDateRaw: string | null;
  payAt: string | null;
  refundAt: string | null;
  currency: string | null;
  orderTotal: number | null;
  qty: number | null;
  refundQty: number | null;
  itemAmount: number | null;
  revenue: number | null;
  promo: string | null;
  shipServiceLevel: string | null;
  fulfillmentChannel: "" | "AFN" | "MFN";
  address: Prisma.InputJsonValue | null;
  payload: Prisma.InputJsonValue;
};

function record(value: unknown, message: string): SellfoxRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SellfoxSyncInputError(message);
  return value as SellfoxRow;
}

function calendarDay(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

/** Verified request path is `/api/order/pageList.json`. Line identity is amazonOrderId + orderItemId. */
export function sellfoxOrderLines(value: unknown, shopExternalId: string): SellfoxOrderLine[] {
  const row = record(value, "订单响应记录无效。");
  if (row.shopId !== shopExternalId) throw new SellfoxSyncInputError("订单响应店铺归属不匹配，已拒绝写入。");
  const orderId = sellfoxText(row, "amazonOrderId");
  const orderStatus = sellfoxText(row, "orderStatus");
  if (!orderId || !orderStatus) throw new SellfoxSyncInputError("订单响应缺少 amazonOrderId 或 orderStatus。");
  if (!Array.isArray(row.orderItemVoList)) throw new SellfoxSyncInputError("订单响应缺少 orderItemVoList。");
  const purchaseDateRaw = sellfoxText(row, "purchaseDate");
  const fulfillment = sellfoxText(row, "fulfillmentChannel") ?? "";
  if (fulfillment !== "" && fulfillment !== "AFN" && fulfillment !== "MFN") throw new SellfoxSyncInputError("订单发货方式不是 AFN/MFN。");
  const address = row.address === undefined || row.address === null ? null : record(row.address, "订单地址结构无效。");
  const header = {
    orderId,
    sellerOrderId: sellfoxText(row, "sellerOrderId"),
    orderStatus,
    purchaseDate: calendarDay(purchaseDateRaw),
    purchaseDateRaw,
    payAt: sellfoxText(row, "payDate"),
    refundAt: sellfoxText(row, "refundDate"),
    currency: sellfoxText(row, "currency"),
    orderTotal: sellfoxNumber(row, "orderTotal"),
    shipServiceLevel: sellfoxText(row, "shipServiceLevel"),
    fulfillmentChannel: fulfillment as "" | "AFN" | "MFN",
    address: address as Prisma.InputJsonValue | null,
    revenue: sellfoxNumber(row, "orderProfit"),
  };
  const lines: SellfoxOrderLine[] = [];
  for (const itemValue of row.orderItemVoList) {
    const item = record(itemValue, "订单商品行无效。");
    const lineKey = sellfoxText(item, "orderItemId");
    const asin = sellfoxText(item, "asin") ?? "";
    const msku = sellfoxText(item, "sellerSku") ?? "";
    const sku = sellfoxText(item, "commoditySku") ?? "";
    if (!lineKey || (!asin && !msku && !sku)) throw new SellfoxSyncInputError("订单商品行缺少 orderItemId 或商品身份。");
    const promo = Array.isArray(item.promotionIds) && item.promotionIds.every((id) => typeof id === "string") ? item.promotionIds.filter(Boolean).join(",") : null;
    lines.push({
      ...header,
      lineKey,
      asin,
      msku,
      sku,
      qty: sellfoxNumber(item, "quantityOrdered", true),
      refundQty: sellfoxNumber(item, "refundQuantity", true),
      itemAmount: sellfoxNumber(item, "itemPrice"),
      promo: promo || null,
      payload: { order: row, item } as Prisma.InputJsonValue,
    });
  }
  if (new Set(lines.map((line) => line.lineKey)).size !== lines.length) throw new SellfoxSyncInputError("订单商品行身份重复。");
  return lines;
}
