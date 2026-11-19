import { Prisma } from "@prisma/client";
import { sellfoxNumber, sellfoxText, type SellfoxRow } from "./narrow-contracts";
import { SellfoxSyncInputError } from "./sync-contract";

/**
 * 订单详情批量接口契约：/api/order/detailByOrderIds.json
 * 契约来源：docs/sellfox-api-docs/API.md#api-476895394（OrderDetailOpenVo，2026-11-19 核对）。
 * 一行一个订单。只抽取文档明确列出的展示字段，完整原始响应保留在 payload；
 * 缺失字段返回 null（不补零、不补前值），金额沿用订单快照口径交 Prisma Decimal(20,4) 落库。
 */
export type SellfoxOrderDetailRow = {
  sellerOrderId: string;
  amazonOrderId: string | null;
  orderStatus: string | null;
  orderTotalCurrency: string | null;
  orderTotalAmount: number | null;
  marketplaceId: string | null;
  orderType: string | null;
  purchaseDate: string | null;
  paymentsDate: string | null;
  refundDate: string | null;
  fulfillmentChannel: string | null;
  settlementStatus: string | null;
  refundStatus: string | null;
  productAmount: number | null;
  refundPrice: number | null;
  fbaPerUnitFulfillmentFee: number | null;
  commission: number | null;
  otherAmount: number | null;
  purchaseCost: number | null;
  headTripCost: number | null;
  fbmShipCost: number | null;
  orderProfit: number | null;
  totalCost: number | null;
  totalRevenue: number | null;
  shippingCharge: number | null;
  promotionDiscount: number | null;
  taxAmount: number | null;
  isBusinessOrder: string | null;
  isReturnOrder: string | null;
  payload: Prisma.InputJsonValue;
};

function record(value: unknown, message: string): SellfoxRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SellfoxSyncInputError(message);
  return value as SellfoxRow;
}

/** 文档字段：sellerOrderId 为卖家订单 ID；详情按店铺单店批量查询。店铺归属不匹配则拒写。 */
export function sellfoxOrderDetailRow(value: unknown, shopExternalId: string): SellfoxOrderDetailRow {
  const row = record(value, "订单详情响应记录无效。");
  const sellerOrderId = sellfoxText(row, "sellerOrderId");
  if (!sellerOrderId) throw new SellfoxSyncInputError("订单详情响应缺少 sellerOrderId。");
  const shopId = sellfoxText(row, "shopId");
  // 部分接口行可能未回带 shopId；回带时必须与查询店铺一致，避免跨店串写。
  if (shopId !== null && shopId !== shopExternalId) throw new SellfoxSyncInputError("订单详情店铺归属不匹配，已拒绝写入。");
  return {
    sellerOrderId,
    amazonOrderId: sellfoxText(row, "amazonOrderId"),
    orderStatus: sellfoxText(row, "orderStatus"),
    orderTotalCurrency: sellfoxText(row, "orderTotalCurrency"),
    orderTotalAmount: sellfoxNumber(row, "orderTotalAmount"),
    marketplaceId: sellfoxText(row, "marketplaceId"),
    orderType: sellfoxText(row, "orderType"),
    purchaseDate: sellfoxText(row, "purchaseDate"),
    paymentsDate: sellfoxText(row, "paymentsDate"),
    refundDate: sellfoxText(row, "refundDate"),
    fulfillmentChannel: sellfoxText(row, "fulfillmentChannel"),
    settlementStatus: sellfoxText(row, "settlementStatus"),
    refundStatus: sellfoxText(row, "refundStatus"),
    productAmount: sellfoxNumber(row, "productAmount"),
    refundPrice: sellfoxNumber(row, "refundPrice"),
    fbaPerUnitFulfillmentFee: sellfoxNumber(row, "fbaPerUnitFulfillmentFee"),
    commission: sellfoxNumber(row, "commission"),
    otherAmount: sellfoxNumber(row, "otherAmount"),
    purchaseCost: sellfoxNumber(row, "purchaseCost"),
    headTripCost: sellfoxNumber(row, "headTripCost"),
    fbmShipCost: sellfoxNumber(row, "fbmShipCost"),
    orderProfit: sellfoxNumber(row, "orderProfit"),
    totalCost: sellfoxNumber(row, "totalCost"),
    totalRevenue: sellfoxNumber(row, "totalRevenue"),
    shippingCharge: sellfoxNumber(row, "shippingCharge"),
    promotionDiscount: sellfoxNumber(row, "promotionDiscount"),
    taxAmount: sellfoxNumber(row, "taxAmount"),
    isBusinessOrder: sellfoxText(row, "isBusinessOrder"),
    isReturnOrder: sellfoxText(row, "isReturnOrder"),
    payload: row as Prisma.InputJsonValue,
  };
}

/**
 * 批量响应解析。sellfoxPost 已解包 payload.data，因此正常入参就是详情数组；
 * 同时兼容未解包的 { code, data } 形态，便于联调与单元测试。非数组一律拒绝。
 */
export function sellfoxOrderDetailRows(payload: unknown): SellfoxRow[] {
  const data = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as SellfoxRow).data
      : null;
  if (!Array.isArray(data)) throw new SellfoxSyncInputError("订单详情批量响应缺少 data 列表。");
  return data as SellfoxRow[];
}
