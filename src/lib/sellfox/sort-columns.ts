/** Shared UI/API allowlist: only fields available before pagination belong here. */
import { isSellfoxDate } from "./sync-contract";
const product = ["identity", "name", "marketplace", "asin", "msku", "sku", "title", "parentAsin", "price", "currency"];
const ads = ["asin", "msku", "title", "name", "marketplace", "campaignId", "adGroupId", "adType", "currency", "price", "rating", "ratingCount", "productTags", "brand", "fulfillment", "buyBoxWinner", "impressions", "clicks", "cost", "adOrders", "adSales", "acos", "roas"];
export const sellfoxSortColumns: Record<string, readonly string[]> = {
  stores: ["name", "externalId", "marketplace", "country", "status", "lastSyncedAt"],
  inventory: ["reportDate", "capturedAt", "name", "marketplace", "asin", "msku", "sku", "fnsku", "quantity", "totalInventory", "inTransit", "inboundWorking", "inboundShipped", "inboundReceiving", "reservedTransfer", "reservedProcessing", "reservedCustomerorders", "unfulfillable", "warehouseName"],
  sales: [...product, "brand", "productTags", "quantity", "subtotal"],
  performance: [...product.filter(key => key !== "price"), "grossProfit", "grossProfitRate", "netProfitRate", "saleRevenue", "netRevenue", "orderNum", "saleQuantity", "promotionDiscount", "giftWrapFee", "adCost", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "evaluationSaleNum", "channelSaleNum", "adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost", "fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount", "customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee", "promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount", "couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount", "fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount", "fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount", "evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount", "commodityCost", "shippingPrice", "taxPrice", "refundRate", "refundPrice", "refundNum", "fbaQuantity", "fbmQuantity"],
  listings: ["status", "fulfillment", "asin", "msku", "sku", "title", "brand", "amazonBrand", "rating", "ratingCount", "productTags", "openDate", "firstSaleDate", "bsrRank", "bsrCategory", "purchaseCost", "fbaFees", "referralFee", "totalFee", "headTripCost", "buyBoxWinner", "reservedQty", "shippingPrice", "profitPrice", "profitRate", "parentAsin", "parentSku", "fnsku", "name", "marketplace", "price", "sales7", "sales14", "sales30", "revenue7", "revenue14", "revenue30", "adSpend7", "adSpend14", "adSpend30", "fulfillable", "listingQuantity", "unsellable", "warehousing", "sourceUpdatedAt", "capturedAt", "currency"],
  ads_report: ads,
  ads_targeting: [...ads, "targetingId", "targetingText", "matchType"],
  ads_search_term: [...ads, "searchTerm", "targetingId", "targetingText", "matchType"],
  ads_campaign: [...ads.filter(key => key !== "adGroupId"), "campaignName"],
  ads_ad_group: [...ads, "adGroupName", "targetingText", "matchType"],
  ads_placement: [...ads, "placement"],
  hourly: ["reportDate", "hour", "adType", "entityName", "name", "marketplace", "impressions", "clicks", "cost", "sales", "orders"],
  runs: ["resource", "status", "startedAt", "finishedAt", "error"],
};
export type SellfoxSortOrder = "asc" | "desc";
/** 日矩阵列：仅销量域、仅合法 YYYY-MM-DD，日期部分作为 SQL 参数而非标识符。 */
export function sellfoxDaySortDate(domain: string, key: string) {
  if (domain !== "sales") return null;
  const match = /^day:(\d{4}-\d{2}-\d{2})$/.exec(key);
  return match && isSellfoxDate(match[1]) ? match[1] : null;
}
export function isSellfoxSortable(domain: string, key: string) {
  if (sellfoxDaySortDate(domain, key)) return true;
  return Object.hasOwn(sellfoxSortColumns, domain) && sellfoxSortColumns[domain].includes(key);
}
