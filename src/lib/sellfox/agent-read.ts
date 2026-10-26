import { sellfoxSortKey, sellfoxSqlOrder } from "./browse-sort";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxBrowseQuery, SellfoxBrowseError, sellfoxExportLimit } from "./browse-query";
import { sellfoxDateAt } from "./sync-contract";
export const sellfoxAgentColumns = {
  "inventory": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "capturedAt",
    "asin",
    "msku",
    "sku",
    "fnsku",
    "quantity",
    "totalInventory",
    "inTransit",
    "inboundWorking",
    "inboundShipped",
    "inboundReceiving",
    "reservedTransfer",
    "reservedProcessing",
    "reservedCustomerorders",
    "unfulfillable",
    "warehouseName",
    "commodityName",
    "currency",
    "avgInventoryCost",
    "avgTransportCost",
    "shopExternalId",
    "name",
    "marketplace"
  ],
  "listings": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "capturedAt",
    "asin",
    "msku",
    "sku",
    "parentAsin",
    "title",
    "status",
    "price",
    "currency",
    "fulfillable",
    "sales7",
    "sales14",
    "sales30",
    "revenue7",
    "revenue14",
    "revenue30",
    "adSpend7",
    "adSpend14",
    "adSpend30",
    "sourceUpdatedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "fnsku",
    "parentSku",
    "mainImage"
  ],
  "sales": [
    "complete",
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "asin",
    "msku",
    "sku",
    "quantity",
    "revenue",
    "currency",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "orders",
    "brand",
    "productTags",
    "price"
  ],
  "performance": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "sourceKey",
    "reportDate",
    "asin",
    "msku",
    "sku",
    "title",
    "currency",
    "saleQuantity",
    "saleRevenue",
    "grossProfit",
    "grossProfitRate",
    "adCost",
    "refundRate",
    "orderNum",
    "netRevenue",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "onlySettle",
    "headTripPrice",
    "avgPurchaseCost",
    "amazonCommissionPrice",
    "evaluationSaleNum",
    "channelSaleNum",
    "adSpCost",
    "adSdCost",
    "adSbCost",
    "adSbvCost",
    "adSbsCost",
    "fbaStorageFeeAmount",
    "fbaLongTermStorageFeeAmount",
    "fbaRemovalFeeAmount",
    "fbaDisposalFeeAmount",
    "customAsinFee",
    "customShopFee",
    "serviceFeeAmount",
    "storageFeeAmount",
    "compensationAmount",
    "evaluationFee",
    "promotionTotalAmount",
    "fbaOverageFeeAmount",
    "chargebackAmount",
    "guaranteeClaimAmount",
    "digitalServicesFeeAmount",
    "otherPriceAmount",
    "shippingChargeAmount",
    "regulatoryFeeAmount",
    "couponPaymentAmount",
    "sellerDealPaymentAmount",
    "vineFeeAmount",
    "starStorageFeeAmount",
    "subscriptionAmount",
    "fbaCustomerReturnAmount",
    "fbaInboundConvenienceFeeAmount",
    "inboundTransportationFeeAmount",
    "shippingChargebackAmount",
    "giftwrapChargebackAmount",
    "costOfPointsGrantedAmount",
    "orderOtherPriceAmount",
    "fbaInboundTransportationProgramFee",
    "aglFeeAmount",
    "paidServicesFeeAmount",
    "customerReturnHrrUnitFeeAmount",
    "amazonUpstreamStorageTransportationFeeAmount",
    "amazonUpstreamProcessingFeeAmount",
    "mfnPostageFeeAmount",
    "adjustmentFeeAmount",
    "otherServiceFeeAmount",
    "avgHeadTripPrice",
    "purchaseRefundPrice",
    "revenueAmount",
    "fbaPerUnitFulfillmentFeeRefundAmount",
    "fbaWeightBasedFeeRefundAmount",
    "deferredAmount",
    "withheldTaxAmount",
    "otherPriceIncomeAmount",
    "paymentMethodFeeAmount",
    "fixedClosingFeeAmount",
    "variableClosingFeeAmount",
    "imagingServicesFeeAmount",
    "netCoAmount",
    "comminglingVatAmount",
    "codFeeAmount",
    "evaluationCapital",
    "evaluationCommission",
    "dealPerformanceFeeAmount",
    "couponParticipationFeeAmount",
    "safetReimbursedAmount",
    "affordabilityExpenseAmount",
    "withheldFeeAmount",
    "chargebackIncomeAmount",
    "guaranteeClaimIncomeAmount",
    "promotionSalesAmount",
    "promotionShippingAmount",
    "promotionTaxAmount"
  ],
  "ads_campaign": ["id", "organizationId", "workspaceId", "storeId", "reportDate", "adType", "campaignId", "campaignName", "asin", "msku", "currency", "impressions", "clicks", "cost", "adOrders", "adSales", "syncedAt", "shopExternalId", "name", "marketplace", "acos", "roas"],
  "ads_ad_group": ["id", "organizationId", "workspaceId", "storeId", "reportDate", "adType", "campaignId", "adGroupId", "adGroupName", "targetingText", "matchType", "asin", "msku", "currency", "impressions", "clicks", "cost", "adOrders", "adSales", "syncedAt", "shopExternalId", "name", "marketplace", "acos", "roas"],
  "ads_placement": ["id", "organizationId", "workspaceId", "storeId", "reportDate", "adType", "campaignId", "placement", "adGroupId", "asin", "msku", "currency", "impressions", "clicks", "cost", "adOrders", "adSales", "syncedAt", "shopExternalId", "name", "marketplace", "acos", "roas"],
  "ads_report": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "reportDate",
    "adType",
    "campaignId",
    "adGroupId",
    "productId",
    "asin",
    "msku",
    "currency",
    "impressions",
    "clicks",
    "cost",
    "adOrders",
    "adSales",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "acos",
    "roas"
  ],
  "ads_targeting": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "reportDate",
    "adType",
    "campaignId",
    "adGroupId",
    "targetingId",
    "targetingText",
    "matchType",
    "asin",
    "msku",
    "currency",
    "impressions",
    "clicks",
    "cost",
    "adOrders",
    "adSales",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "acos",
    "roas"
  ],
  "ads_search_term": [
    "id",
    "organizationId",
    "workspaceId",
    "storeId",
    "reportDate",
    "adType",
    "campaignId",
    "adGroupId",
    "searchTerm",
    "targetingId",
    "targetingText",
    "matchType",
    "asin",
    "msku",
    "currency",
    "impressions",
    "clicks",
    "cost",
    "adOrders",
    "adSales",
    "syncedAt",
    "shopExternalId",
    "name",
    "marketplace",
    "acos",
    "roas"
  ]
} as const;
export type AgentDomain = keyof typeof sellfoxAgentColumns;
const views: Record<AgentDomain, string> = { inventory: "sellfox_inventory_current", listings: "sellfox_listing_current", sales: "sellfox_sales_daily", performance: "sellfox_profit_daily", ads_report: "sellfox_ads_product_daily", ads_targeting: "sellfox_ads_targeting_daily", ads_search_term: "sellfox_ads_search_term_daily", ads_campaign: "sellfox_ads_campaign_daily", ads_ad_group: "sellfox_ads_ad_group_daily", ads_placement: "sellfox_ads_placement_daily" };
export function isSellfoxAgentDomain(domain: string): domain is AgentDomain { return Object.prototype.hasOwnProperty.call(views, domain); }
export async function readSellfoxAgentRows(domain: AgentDomain, query: ReturnType<typeof sellfoxBrowseQuery>, scope: { organizationId: string; workspaceId: string }, exporting = false) {
  const sortKey = sellfoxSortKey(domain, query);
  const sortColumn = sellfoxAgentColumns[domain].find(key => key === sortKey);
  if (sortKey && !sortColumn) throw new SellfoxBrowseError("该窄表不支持此排序列，请使用 workbench 布局。");
  const clauses = [Prisma.sql`"organizationId"=${scope.organizationId}`, Prisma.sql`"workspaceId"=${scope.workspaceId}`];
  if (query.shopExternalIds.length) clauses.push(Prisma.sql`"shopExternalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (domain === "listings" && query.status) clauses.push(Prisma.sql`status ILIKE ${query.status}`);
  if (domain === "performance") clauses.push(Prisma.sql`"onlySettle"=${query.onlySettle}`);
  if (domain === "listings" && query.fulfillment) clauses.push(Prisma.sql`s.fulfillment=${query.fulfillment}`);
  else if (query.fulfillment && ["sales", "performance"].includes(domain)) {
    // Match the same current Listing as workbench images, then test its value.
    // Do not prefilter candidates: an ASIN sibling must not override an exact MSKU.
    const match = domain === "listings" ? Prisma.sql`candidate.id=s.id` : Prisma.sql`((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin))`;
    clauses.push(Prisma.sql`(SELECT candidate.fulfillment
      FROM sellfox_listing_current candidate
      WHERE candidate."organizationId"=${scope.organizationId} AND candidate."workspaceId"=${scope.workspaceId}
        AND candidate."storeId"=s."storeId" AND ${match}
      ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1)=${query.fulfillment}`);
  }
  if (domain === "listings" && query.buyBox) clauses.push(Prisma.sql`s."buyBoxWinner"=${query.buyBox === "yes" ? "是" : "否"}`);
  else if (query.buyBox && ["sales", "performance"].includes(domain)) {
    // Select the same current Listing before testing its boolean; unknown values never match.
    const match = domain === "listings" ? Prisma.sql`candidate.id=s.id` : Prisma.sql`((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin))`;
    clauses.push(Prisma.sql`(SELECT candidate."buyBoxWinner"
      FROM sellfox_listing_current candidate
      WHERE candidate."organizationId"=${scope.organizationId} AND candidate."workspaceId"=${scope.workspaceId}
        AND candidate."storeId"=s."storeId" AND ${match}
      ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1)=${query.buyBox === "yes" ? "是" : "否"}`);
  }
  if (domain === "listings" && query.brand) clauses.push(Prisma.sql`s.brand=${query.brand}`);
  else if (query.brand && ["sales", "performance"].includes(domain)) {
    // Test the chosen current Listing after MSKU-first/ASIN-fallback selection.
    const match = domain === "listings" ? Prisma.sql`candidate.id=s.id` : Prisma.sql`((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin))`;
    clauses.push(Prisma.sql`(SELECT candidate.brand
      FROM sellfox_listing_current candidate
      WHERE candidate."organizationId"=${scope.organizationId} AND candidate."workspaceId"=${scope.workspaceId}
        AND candidate."storeId"=s."storeId" AND ${match}
      ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1)=${query.brand}`);
  }
  if (domain === "performance" && query.salesperson) clauses.push(Prisma.sql`s."userNameList" @> ARRAY[${query.salesperson}]::text[]`);
  if (domain === "listings" && query.productTag) clauses.push(Prisma.sql`s."productTagNames" @> ARRAY[${query.productTag}]::text[]`);
  else if (query.productTag && ["sales", "performance"].includes(domain)) {
    // Select the same stable candidate BEFORE testing membership (no ASIN sibling substitution).
    const match = domain === "listings" ? Prisma.sql`candidate.id=s.id` : Prisma.sql`((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin))`;
    clauses.push(Prisma.sql`(SELECT candidate."productTagNames"
      FROM sellfox_listing_current candidate
      WHERE candidate."organizationId"=${scope.organizationId} AND candidate."workspaceId"=${scope.workspaceId}
        AND candidate."storeId"=s."storeId" AND ${match}
      ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1) @> ARRAY[${query.productTag}]::text[]`);
  }
  if (domain === "listings" && query.dxmPublishState) clauses.push(Prisma.sql`s."dxmPublishState"=${query.dxmPublishState}`);
  if (domain === "listings" && query.bsrCategory) clauses.push(Prisma.sql`s."bsrCategory"=${query.bsrCategory}`);
  if (domain === "listings" && query.from) clauses.push(Prisma.sql`s."openDate">=${query.from}`);
  if (domain === "listings" && query.to) clauses.push(Prisma.sql`s."openDate"<=${query.to}`);
  if (domain === "listings" && query.firstSaleFrom) clauses.push(Prisma.sql`s."firstSaleDate">=${query.firstSaleFrom}`);
  if (domain === "listings" && query.firstSaleTo) clauses.push(Prisma.sql`s."firstSaleDate"<=${query.firstSaleTo}`);
  if (domain === "listings" && (query.totalInventoryMin != null || query.totalInventoryMax != null)) {
    const bounds = [Prisma.sql`stock.inv IS NOT NULL`];
    if (query.totalInventoryMin != null) bounds.push(Prisma.sql`stock.inv>=${query.totalInventoryMin}`);
    if (query.totalInventoryMax != null) bounds.push(Prisma.sql`stock.inv<=${query.totalInventoryMax}`);
    clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM (SELECT CASE WHEN count(i."totalInventory")=count(*) THEN sum(i."totalInventory") END AS inv FROM sellfox_inventory_current i WHERE i."organizationId"=s."organizationId" AND i."workspaceId"=s."workspaceId" AND i."storeId"=s."storeId" AND i.msku=s.msku GROUP BY i."storeId", i.msku) stock WHERE ${Prisma.join(bounds, " AND ")})`);
  }
  if (domain === "listings" && (query.fulfillableMin != null || query.fulfillableMax != null)) {
    clauses.push(Prisma.sql`s."fulfillable" IS NOT NULL`);
    if (query.fulfillableMin != null) clauses.push(Prisma.sql`s."fulfillable">=${query.fulfillableMin}`);
    if (query.fulfillableMax != null) clauses.push(Prisma.sql`s."fulfillable"<=${query.fulfillableMax}`);
  }
  if (domain === "listings" && (query.bsrRankMin != null || query.bsrRankMax != null)) {
    clauses.push(Prisma.sql`s."bsrRank" IS NOT NULL`);
    if (query.bsrRankMin != null) clauses.push(Prisma.sql`s."bsrRank">=${query.bsrRankMin}`);
    if (query.bsrRankMax != null) clauses.push(Prisma.sql`s."bsrRank"<=${query.bsrRankMax}`);
  }
  if (domain === "listings" && (query.priceMin != null || query.priceMax != null)) {
    clauses.push(Prisma.sql`s.price IS NOT NULL`);
    if (query.priceMin != null) clauses.push(Prisma.sql`s.price>=${query.priceMin}`);
    if (query.priceMax != null) clauses.push(Prisma.sql`s.price<=${query.priceMax}`);
  }
  if (domain === "listings" && (query.sales7Min != null || query.sales7Max != null)) {
    clauses.push(Prisma.sql`s."sales7" IS NOT NULL`);
    if (query.sales7Min != null) clauses.push(Prisma.sql`s."sales7">=${query.sales7Min}`);
    if (query.sales7Max != null) clauses.push(Prisma.sql`s."sales7"<=${query.sales7Max}`);
  }
  if (domain === "listings" && (query.sales14Min != null || query.sales14Max != null)) {
    clauses.push(Prisma.sql`s."sales14" IS NOT NULL`);
    if (query.sales14Min != null) clauses.push(Prisma.sql`s."sales14">=${query.sales14Min}`);
    if (query.sales14Max != null) clauses.push(Prisma.sql`s."sales14"<=${query.sales14Max}`);
  }
  if (domain === "listings" && (query.sales30Min != null || query.sales30Max != null)) {
    clauses.push(Prisma.sql`s."sales30" IS NOT NULL`);
    if (query.sales30Min != null) clauses.push(Prisma.sql`s."sales30">=${query.sales30Min}`);
    if (query.sales30Max != null) clauses.push(Prisma.sql`s."sales30"<=${query.sales30Max}`);
  }
  if (domain === "listings" && (query.revenue7Min != null || query.revenue7Max != null)) {
    clauses.push(Prisma.sql`s."revenue7" IS NOT NULL`);
    if (query.revenue7Min != null) clauses.push(Prisma.sql`s."revenue7">=${query.revenue7Min}`);
    if (query.revenue7Max != null) clauses.push(Prisma.sql`s."revenue7"<=${query.revenue7Max}`);
  }
  if (domain === "listings" && (query.revenue14Min != null || query.revenue14Max != null)) {
    clauses.push(Prisma.sql`s."revenue14" IS NOT NULL`);
    if (query.revenue14Min != null) clauses.push(Prisma.sql`s."revenue14">=${query.revenue14Min}`);
    if (query.revenue14Max != null) clauses.push(Prisma.sql`s."revenue14"<=${query.revenue14Max}`);
  }
  if (domain === "listings" && (query.revenue30Min != null || query.revenue30Max != null)) {
    clauses.push(Prisma.sql`s."revenue30" IS NOT NULL`);
    if (query.revenue30Min != null) clauses.push(Prisma.sql`s."revenue30">=${query.revenue30Min}`);
    if (query.revenue30Max != null) clauses.push(Prisma.sql`s."revenue30"<=${query.revenue30Max}`);
  }
  if (domain === "listings" && (query.listingQuantityMin != null || query.listingQuantityMax != null)) {
    clauses.push(Prisma.sql`s."listingQuantity" IS NOT NULL`);
    if (query.listingQuantityMin != null) clauses.push(Prisma.sql`s."listingQuantity">=${query.listingQuantityMin}`);
    if (query.listingQuantityMax != null) clauses.push(Prisma.sql`s."listingQuantity"<=${query.listingQuantityMax}`);
  }
  if (domain === "listings" && (query.reservedQtyMin != null || query.reservedQtyMax != null)) {
    clauses.push(Prisma.sql`s."reservedQty" IS NOT NULL`);
    if (query.reservedQtyMin != null) clauses.push(Prisma.sql`s."reservedQty">=${query.reservedQtyMin}`);
    if (query.reservedQtyMax != null) clauses.push(Prisma.sql`s."reservedQty"<=${query.reservedQtyMax}`);
  }
  if (domain === "listings" && (query.unsellableMin != null || query.unsellableMax != null)) {
    clauses.push(Prisma.sql`s."unsellable" IS NOT NULL`);
    if (query.unsellableMin != null) clauses.push(Prisma.sql`s."unsellable">=${query.unsellableMin}`);
    if (query.unsellableMax != null) clauses.push(Prisma.sql`s."unsellable"<=${query.unsellableMax}`);
  }
  if (domain === "listings" && (query.warehousingMin != null || query.warehousingMax != null)) {
    clauses.push(Prisma.sql`s."warehousing" IS NOT NULL`);
    if (query.warehousingMin != null) clauses.push(Prisma.sql`s."warehousing">=${query.warehousingMin}`);
    if (query.warehousingMax != null) clauses.push(Prisma.sql`s."warehousing"<=${query.warehousingMax}`);
  }
  if (query.storeId) clauses.push(Prisma.sql`"storeId"=${query.storeId}`);
  if (query.site) clauses.push(Prisma.sql`marketplace=${query.site}`);
  const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain);
  if (ads && query.adType) clauses.push(Prisma.sql`"adType"=${query.adType}`);
  if (ads && (query.costMin != null || query.costMax != null)) {
    clauses.push(Prisma.sql`cost IS NOT NULL`);
    if (query.costMin != null) clauses.push(Prisma.sql`cost>=${query.costMin}`);
    if (query.costMax != null) clauses.push(Prisma.sql`cost<=${query.costMax}`);
  }
  if (ads && (query.adSalesMin != null || query.adSalesMax != null)) {
    clauses.push(Prisma.sql`"adSales" IS NOT NULL`);
    if (query.adSalesMin != null) clauses.push(Prisma.sql`"adSales">=${query.adSalesMin}`);
    if (query.adSalesMax != null) clauses.push(Prisma.sql`"adSales"<=${query.adSalesMax}`);
  }
  if (ads && (query.impressionsMin != null || query.impressionsMax != null)) {
    clauses.push(Prisma.sql`impressions IS NOT NULL`);
    if (query.impressionsMin != null) clauses.push(Prisma.sql`impressions>=${query.impressionsMin}`);
    if (query.impressionsMax != null) clauses.push(Prisma.sql`impressions<=${query.impressionsMax}`);
  }
  if (ads && (query.clicksMin != null || query.clicksMax != null)) {
    clauses.push(Prisma.sql`clicks IS NOT NULL`);
    if (query.clicksMin != null) clauses.push(Prisma.sql`clicks>=${query.clicksMin}`);
    if (query.clicksMax != null) clauses.push(Prisma.sql`clicks<=${query.clicksMax}`);
  }
  if (ads && (query.adOrdersMin != null || query.adOrdersMax != null)) {
    clauses.push(Prisma.sql`"adOrders" IS NOT NULL`);
    if (query.adOrdersMin != null) clauses.push(Prisma.sql`"adOrders">=${query.adOrdersMin}`);
    if (query.adOrdersMax != null) clauses.push(Prisma.sql`"adOrders"<=${query.adOrdersMax}`);
  }
  if (ads && query.quickFilter === "spend") clauses.push(Prisma.sql`cost>0`);
  if (ads && query.quickFilter === "clicksNoOrders") clauses.push(Prisma.sql`clicks>0 AND "adOrders"=0`);
  if (ads && query.quickFilter === "spendNoClicks") clauses.push(Prisma.sql`cost>0 AND clicks=0`);
  if (ads && query.quickFilter === "noClicks") clauses.push(Prisma.sql`clicks=0`);
  if (query.search) {
    const fields = ads ? ["asin", "msku", "campaignId", ...(domain === "ads_campaign" ? ["campaignName"] : domain === "ads_ad_group" ? ["adGroupId", "adGroupName", "targetingText"] : domain === "ads_placement" ? ["placement", "adGroupId"] : ["adGroupId", ...(domain === "ads_report" ? ["productId"] : domain === "ads_targeting" ? ["targetingId", "targetingText"] : ["searchTerm", "targetingId", "targetingText"])]), "name"] : ["asin", "msku", "sku", "name"];
    const typedAds = ["ads_campaign", "ads_ad_group", "ads_placement"].includes(domain);
    if (typedAds && query.searchType && !fields.includes(query.searchType)) throw new SellfoxBrowseError("当前域不支持该搜索类型。");
    const selected = typedAds && query.searchType ? [query.searchType] : fields;
    clauses.push(Prisma.sql`(${Prisma.join(selected.map((key) => typedAds && query.exactMatch ? Prisma.sql`lower(${Prisma.raw(`"${key}"`)})=lower(${query.search})` : Prisma.sql`${Prisma.raw(`"${key}"`)} ILIKE ${`%${query.search}%`}`), " OR ")})`);
  }
  if (domain !== "listings" && domain !== "inventory") {
    if (query.from) clauses.push(Prisma.sql`"reportDate">=${query.from}`);
    if (query.to) clauses.push(Prisma.sql`"reportDate"<=${query.to}`);
    if (!query.from && !query.to && !query.allDates) clauses.push(Prisma.sql`"reportDate"=${query.reportDate ?? sellfoxDateAt(new Date(), -1)}`);
  }
  const source = Prisma.raw(views[domain]); // closed constant map, never request text
  // Append current Listing metadata without changing the sales-day grain or historical facts.
  const listing = domain === "sales" ? Prisma.sql`LEFT JOIN LATERAL (
    SELECT candidate.brand AS "listingBrand",candidate."productTags" AS "listingProductTags",candidate.price AS "listingPrice"
    FROM sellfox_listing_current candidate
    WHERE candidate."organizationId"=${scope.organizationId} AND candidate."workspaceId"=${scope.workspaceId}
      AND candidate."storeId"=s."storeId" AND ((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin))
    ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1
  ) l ON TRUE` : Prisma.empty;
  const columns = Prisma.join(sellfoxAgentColumns[domain].map((key) => {
    if (domain === "sales") {
      if (key === "brand") return Prisma.sql`l."listingBrand" AS brand`;
      if (key === "productTags") return Prisma.sql`l."listingProductTags" AS "productTags"`;
      if (key === "price") return Prisma.sql`l."listingPrice" AS price`;
    }
    return Prisma.raw(`"${key}"`);
  }));
  const where = Prisma.join(clauses, " AND ");
  const order = sortColumn ? sellfoxSqlOrder(query, Prisma.raw(`"${sortColumn}"`)) : Prisma.raw(domain === "inventory" || domain === "listings" ? '"capturedAt" DESC, id' : '"reportDate" DESC, id');
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT ${columns} FROM ${source} s ${listing} WHERE ${where} ORDER BY ${order} LIMIT ${exporting ? sellfoxExportLimit + 1 : query.pageSize} OFFSET ${exporting ? 0 : (query.page - 1) * query.pageSize}`);
  if (exporting && rows.length > sellfoxExportLimit) throw new SellfoxBrowseError("导出超过 10,000 条，请缩小日期或店铺范围并分段。", 413);
  const counts = exporting ? [{ total: rows.length }] : await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::integer AS total FROM ${source} s WHERE ${where}`);
  return { rows, pagination: { page: query.page, pageSize: query.pageSize, total: counts[0].total } };
}
export function sellfoxAgentCsv(domain: AgentDomain, rows: Record<string, unknown>[]) {
  const cell = (value: unknown) => {
    if (typeof value === "number") return String(value);
    let text = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const columns = sellfoxAgentColumns[domain];
  return "\uFEFF" + [columns, ...rows.map((row) => columns.map((key) => row[key]))].map((line) => line.map(cell).join(",")).join("\r\n");
}
