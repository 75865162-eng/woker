import { listingsReadSql } from "./listings-read";
import { sellfoxSortKey, sellfoxSqlOrder } from "./browse-sort";
import { sellfoxAgentColumns } from "./agent-read";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SellfoxBrowseError, sellfoxExportLimit, type SellfoxBrowseQuery } from "./browse-query";
import { sellfoxDateAt } from "./sync-contract";
import { resolveEffectiveReportDate } from "./browse-report-date";

type Scope = { organizationId: string; workspaceId: string };
type Row = Record<string, unknown>;
export type WorkbenchDomain = "sales" | "performance" | "listings" | "ads_report" | "ads_targeting" | "ads_search_term" | "ads_campaign" | "ads_ad_group" | "ads_placement";
const sources = { sales: "sellfox_sales_daily", performance: '"SellfoxProductDailySnapshot"', listings: "sellfox_listing_current", ads_report: "sellfox_ads_product_daily", ads_targeting: "sellfox_ads_targeting_daily", ads_search_term: "sellfox_ads_search_term_daily", ads_campaign: "sellfox_ads_campaign_daily", ads_ad_group: "sellfox_ads_ad_group_daily", ads_placement: "sellfox_ads_placement_daily" };
function scoped(alias: string, scope: Scope) {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}."organizationId"=${scope.organizationId} AND ${a}."workspaceId"=${scope.workspaceId}`;
}
function dateSpan(from: string, to: string) {
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}
export function workbenchDateRange(query: SellfoxBrowseQuery) {
  const yesterday = sellfoxDateAt(new Date(), -1);
  const from = query.from || query.reportDate || query.to || yesterday;
  const to = query.to || query.reportDate || query.from || yesterday;
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (query.allDates && !query.from && !query.to) throw new SellfoxBrowseError("日矩阵需选择最多90天的日期范围；全部历史请使用 Agent 窄表导出。", 400);
  if (count > 90) throw new SellfoxBrowseError("日矩阵最多展示90天，请分段选择日期；完整长窗仍可用 Agent 窄表导出。", 400);
  return dateSpan(from, to);
}
// All joins stay in the authenticated workspace. Current metadata is supplemental,
// never historical parent identity, price or inventory at the sale date.
export function workbenchReadSql(domain: WorkbenchDomain, query: SellfoxBrowseQuery, scope: Scope, exporting = false) {
  if (domain === "listings") return listingsReadSql(query, scope, exporting);
  const dimension = domain === "performance" && query.dimension === "spu" ? "asin" : query.dimension;
  const sortKey = sellfoxSortKey(domain, query);
  let sortExpression = sortKey ? Prisma.raw(`"${sortKey}"`) : Prisma.sql`id`;
  if (sortKey === "identity" && ["store", "developer", "spu"].includes(dimension)) sortExpression = Prisma.sql`name`;
  if (domain === "performance" && sortKey === "grossProfitRate") sortExpression = Prisma.sql`CASE WHEN "saleRevenue">0 THEN "grossProfit"/"saleRevenue" END`;
  if (domain === "performance" && sortKey === "netProfitRate") sortExpression = Prisma.sql`CASE WHEN "netRevenue">0 THEN "grossProfit"/"netRevenue" END`;
  if (sortKey === "acos") sortExpression = Prisma.sql`CASE WHEN "adSales">0 THEN cost/"adSales" END`;
  if (sortKey === "roas") sortExpression = Prisma.sql`CASE WHEN cost>0 THEN "adSales"/cost END`;
  const order = sortKey ? sellfoxSqlOrder(query, sortExpression) : Prisma.sql`id`;
  const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain);
  const adIdentity = domain === "ads_campaign" ? Prisma.sql`"adType","campaignId"` : domain === "ads_ad_group" ? Prisma.sql`"adType","campaignId","adGroupId"` : domain === "ads_placement" ? Prisma.sql`"adType","campaignId",placement` : domain === "ads_targeting" ? Prisma.sql`"adType","campaignId","adGroupId","targetingId"` : domain === "ads_search_term" ? Prisma.sql`"adType","campaignId","adGroupId","searchTerm","targetingId"` : Prisma.sql`"adType","campaignId","adGroupId","productId"`;
  const supportsProductTags = ads || ["sales", "performance", "listings"].includes(domain);
  const needTagFilter = supportsProductTags && Boolean(query.productTag);
  const needTagFacets = supportsProductTags && !exporting;
  const filters: Prisma.Sql[] = [scoped("s", scope)];
  if (query.shopExternalIds.length) filters.push(Prisma.sql`st."externalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (query.storeId) filters.push(Prisma.sql`s."storeId"=${query.storeId}`);
  if (query.site) filters.push(Prisma.sql`st.marketplace=${query.site}`);
  if (query.currency) filters.push(Prisma.sql`s.currency=${query.currency}`);
  if (domain === "sales") {
    const dates = workbenchDateRange(query);
    filters.push(Prisma.sql`s."reportDate">=${dates[0]} AND s."reportDate"<=${dates.at(-1)}`);
    // Exclude coverage-skew orders-only/empty shells before day/entity/KPI aggregation.
    // Incomplete rows with quantity or revenue still propagate unknowns.
    filters.push(Prisma.sql`NOT (NOT s.complete AND s.quantity IS NULL AND s.revenue IS NULL)`);
  } else {
    if (query.from) filters.push(Prisma.sql`s."reportDate">=${query.from}`);
    if (query.to) filters.push(Prisma.sql`s."reportDate"<=${query.to}`);
    if (!query.from && !query.to && !query.allDates) filters.push(Prisma.sql`s."reportDate"=${query.reportDate || sellfoxDateAt(new Date(), -1)}`);
  }
  if (ads && query.adType) filters.push(Prisma.sql`s."adType"=${query.adType}`);
  if (domain === "performance") filters.push(Prisma.sql`s."onlySettle"=${query.onlySettle}`);
  // Facets follow fact scope/date/currency/settlement, ignoring member selections/search.
  const salespersonFacetFilters = [...filters];
  if (domain === "performance" && query.salesperson) filters.push(Prisma.sql`s."userNameList" @> ARRAY[${query.salesperson}]::text[]`);
  // Current Listing metadata: filter member rows before any entity/day/KPI rollup.
  // Blank/unknown values remain in all, never in the AFN/MFN subsets.
  if (query.fulfillment && (ads || ["sales", "performance", "listings"].includes(domain))) filters.push(Prisma.sql`l.fulfillment=${query.fulfillment}`);
  // Current Listing Buy Box: blank/non-boolean values stay in all, never in yes/no subsets.
  if (query.buyBox && (ads || ["sales", "performance", "listings"].includes(domain))) filters.push(Prisma.sql`l."buyBoxWinner"=${query.buyBox === "yes" ? "是" : "否"}`);
  // Test the chosen Listing, never prefilter candidates before the MSKU/ASIN LIMIT 1.
  if (needTagFilter) filters.push(Prisma.sql`l."matchesProductTag"`);
  if (query.brand && (ads || ["sales", "performance", "listings"].includes(domain))) filters.push(Prisma.sql`l.brand=${query.brand}`);
  // Ads Listing-joined typed rating (ratingValue Float); NULL excluded when either bound is set.
  if (ads && (query.ratingMin != null || query.ratingMax != null)) {
    filters.push(Prisma.sql`l."ratingValue" IS NOT NULL`);
    if (query.ratingMin != null) filters.push(Prisma.sql`l."ratingValue">=${query.ratingMin}`);
    if (query.ratingMax != null) filters.push(Prisma.sql`l."ratingValue"<=${query.ratingMax}`);
  }
  // Ads Listing-joined typed ratingCount; NULL excluded when either bound is set.
  if (ads && (query.ratingCountMin != null || query.ratingCountMax != null)) {
    filters.push(Prisma.sql`l."ratingCount" IS NOT NULL`);
    if (query.ratingCountMin != null) filters.push(Prisma.sql`l."ratingCount">=${query.ratingCountMin}`);
    if (query.ratingCountMax != null) filters.push(Prisma.sql`l."ratingCount"<=${query.ratingCountMax}`);
  }
  // Ads daily typed cost (Float?); filter member rows before entity/KPI rollup; NULL excluded when either bound is set.
  if (ads && (query.costMin != null || query.costMax != null)) {
    filters.push(Prisma.sql`s.cost IS NOT NULL`);
    if (query.costMin != null) filters.push(Prisma.sql`s.cost>=${query.costMin}`);
    if (query.costMax != null) filters.push(Prisma.sql`s.cost<=${query.costMax}`);
  }
  // Ads daily typed adSales (Float?); filter member rows before entity/KPI rollup; NULL excluded when either bound is set.
  if (ads && (query.adSalesMin != null || query.adSalesMax != null)) {
    filters.push(Prisma.sql`s."adSales" IS NOT NULL`);
    if (query.adSalesMin != null) filters.push(Prisma.sql`s."adSales">=${query.adSalesMin}`);
    if (query.adSalesMax != null) filters.push(Prisma.sql`s."adSales"<=${query.adSalesMax}`);
  }
  const salesMetric = query.metric === "orders" ? "orders" : query.metric === "revenue" ? "revenue" : "quantity";
  const source = Prisma.raw(sources[domain]);
  const crossStore = (domain === "sales" || domain === "performance") && ["developer", "spu"].includes(dimension);
  const storeColumn = crossStore ? Prisma.sql`CASE WHEN count("storeId")=count(*) AND count(DISTINCT "storeId")=1 THEN min("storeId") END AS "storeId"` : Prisma.sql`"storeId"`;
  const storeGrain = crossStore ? Prisma.empty : Prisma.sql`"storeId",`;
  const marketplace = crossStore ? Prisma.sql`CASE WHEN count("storeId")=count(*) AND count(DISTINCT "storeId")=1 THEN min("storeSite") END` : Prisma.sql`min("storeSite")`;
  const dim = dimension === "store" ? Prisma.sql`s."storeId"` : dimension === "developer" ? Prisma.sql`COALESCE(l.developer,'未分配开发员')` : dimension === "spu" ? Prisma.sql`COALESCE(l.spu,'未分配SPU')` : Prisma.raw(`s."${dimension}"`); // query parser closed enum
  const identity = domain === "sales" && dimension === "parentAsin" ? Prisma.sql`l."parentAsin"` : dim;
  const baseIdentity = Prisma.sql`COALESCE(NULLIF(${identity},''), NULLIF(s.msku,''), s.id)`;
  const searchFields = [Prisma.sql`s.asin`, Prisma.sql`s.msku`, Prisma.sql`s.sku`, Prisma.sql`l.title`];
  if (ads) { searchFields.splice(2, 1); searchFields.push(Prisma.sql`s."campaignId"`); if (domain !== "ads_campaign") searchFields.push(Prisma.sql`s."adGroupId"`); }
  if (domain === "sales" || domain === "performance") searchFields.push(identity);
  if ((domain === "sales" || domain === "performance") && dimension === "store") searchFields.push(Prisma.sql`st.name`);
  if (domain === "performance") searchFields.push(Prisma.sql`s.title`);
  const typedSearch: Record<string, Prisma.Sql> = { asin: Prisma.sql`s.asin`, msku: Prisma.sql`s.msku`, title: domain === "performance" ? Prisma.sql`s.title` : Prisma.sql`l.title` };
  if (!ads) typedSearch.sku = Prisma.sql`s.sku`;
  if (domain === "sales" || domain === "performance") typedSearch.parentAsin = domain === "sales" ? Prisma.sql`l."parentAsin"` : Prisma.sql`s."parentAsin"`;
  if (ads) { typedSearch.campaignId = Prisma.sql`s."campaignId"`; if (domain !== "ads_campaign") typedSearch.adGroupId = Prisma.sql`s."adGroupId"`; }
  if (domain === "ads_targeting" || domain === "ads_search_term") {
    searchFields.push(Prisma.sql`s."targetingId"`, Prisma.sql`s."targetingText"`);
    typedSearch.targetingId = Prisma.sql`s."targetingId"`;
  }
  if (domain === "ads_search_term") { searchFields.push(Prisma.sql`s."searchTerm"`); typedSearch.searchTerm = Prisma.sql`s."searchTerm"`; }
  if (domain === "ads_placement") { searchFields.push(Prisma.sql`s.placement`); typedSearch.placement = Prisma.sql`s.placement`; }
  if (domain === "ads_campaign") searchFields.push(Prisma.sql`s."campaignName"`);
  if (domain === "ads_ad_group") searchFields.push(Prisma.sql`s."adGroupName"`, Prisma.sql`s."targetingText"`);
  const selectedSearch = query.searchType ? typedSearch[query.searchType] : undefined;
  if (query.searchType && !selectedSearch) throw new SellfoxBrowseError("当前域不支持该搜索类型。");
  if (query.search) filters.push(Prisma.sql`(${Prisma.join((selectedSearch ? [selectedSearch] : searchFields).map(field => query.exactMatch ? Prisma.sql`lower(${field})=lower(${query.search})` : Prisma.sql`${field} ILIKE ${`%${query.search}%`}`), " OR ")})`);
  const fields = domain === "sales" ? Prisma.sql`s.id,s."storeId",s."reportDate",s.asin,s.msku,s.sku,s.currency,s.quantity,s.revenue,s.orders,s.complete,${baseIdentity} AS identity`
    : domain === "performance" ? Prisma.sql`s.id,s."storeId",s."reportDate",s.asin,s.msku,s.sku,s.currency,s."userNameList",s.title,s."parentAsin",s."saleQuantity",s."saleRevenue",s."grossProfit",s."adCost",s."promotionDiscount",s."giftWrapFee",s."imageUrl",s."orderNum",s."netRevenue",s."refundRate",s."refundPrice",s."refundNum",s."commodityCost",s."shippingPrice",s."taxPrice",s."headTripPrice",s."avgPurchaseCost",s."amazonCommissionPrice",s."evaluationSaleNum",s."channelSaleNum",s."adSpCost",s."adSdCost",s."adSbCost",s."adSbvCost",s."adSbsCost",s."fbaStorageFeeAmount",s."fbaLongTermStorageFeeAmount",s."fbaRemovalFeeAmount",s."fbaDisposalFeeAmount",s."customAsinFee",s."customShopFee",s."serviceFeeAmount",s."storageFeeAmount",s."compensationAmount",s."evaluationFee",s."promotionTotalAmount",s."fbaOverageFeeAmount",s."chargebackAmount",s."guaranteeClaimAmount",s."digitalServicesFeeAmount",s."otherPriceAmount",s."shippingChargeAmount",s."regulatoryFeeAmount",s."couponPaymentAmount",s."sellerDealPaymentAmount",s."vineFeeAmount",s."starStorageFeeAmount",s."subscriptionAmount",s."fbaCustomerReturnAmount",s."fbaInboundConvenienceFeeAmount",s."inboundTransportationFeeAmount",s."shippingChargebackAmount",s."giftwrapChargebackAmount",s."costOfPointsGrantedAmount",s."orderOtherPriceAmount",s."fbaInboundTransportationProgramFee",s."aglFeeAmount",s."paidServicesFeeAmount",s."customerReturnHrrUnitFeeAmount",s."amazonUpstreamStorageTransportationFeeAmount",s."amazonUpstreamProcessingFeeAmount",s."mfnPostageFeeAmount",s."adjustmentFeeAmount",s."otherServiceFeeAmount",s."avgHeadTripPrice",s."purchaseRefundPrice",s."revenueAmount",s."fbaPerUnitFulfillmentFeeRefundAmount",s."fbaWeightBasedFeeRefundAmount",s."deferredAmount",s."withheldTaxAmount",s."otherPriceIncomeAmount",s."paymentMethodFeeAmount",s."fixedClosingFeeAmount",s."variableClosingFeeAmount",s."imagingServicesFeeAmount",s."netCoAmount",s."comminglingVatAmount",s."codFeeAmount",s."evaluationCapital",s."evaluationCommission",s."dealPerformanceFeeAmount",s."couponParticipationFeeAmount",s."safetReimbursedAmount",s."affordabilityExpenseAmount",s."withheldFeeAmount",s."chargebackIncomeAmount",s."guaranteeClaimIncomeAmount",s."promotionSalesAmount",s."promotionShippingAmount",s."promotionTaxAmount",s."fbaQuantity",s."fbmQuantity",${baseIdentity} AS identity`
    : Prisma.join(sellfoxAgentColumns[domain].map(key => Prisma.raw(`s."${key}"`)));
  const listing = Prisma.sql`listing AS (
    SELECT l.id,l."storeId",l.msku,l.asin,l."parentAsin",l.title,l."mainImage",l.price,
      ${domain === "sales" || ads ? Prisma.sql`l."productTags",` : Prisma.empty}l.brand,l.rating,${ads ? Prisma.sql`l."ratingCount",l."ratingValue",` : Prisma.empty}l."buyBoxWinner",l.fulfillment,
      ${needTagFilter ? Prisma.sql`l."productTagNames" @> ARRAY[${query.productTag}]::text[] AS "matchesProductTag",` : Prisma.empty}
      COALESCE(l.developer,'未分配开发员') AS developer,
      COALESCE(l.spu,'未分配SPU') AS spu
    FROM sellfox_listing_current l
    WHERE ${scoped("l", scope)}
  )`;
  const base = Prisma.sql`base AS (SELECT ${fields},st.name AS "storeName",st.marketplace AS "storeSite",
    ${domain === "sales" ? Prisma.sql`l.brand AS "listingBrand",l."productTags" AS "listingProductTags",` : Prisma.empty}${ads ? Prisma.sql`l.rating AS "listingRating",l."ratingCount" AS "listingRatingCount",l."productTags" AS "listingProductTags",l.brand AS "listingBrand",l.fulfillment AS "listingFulfillment",l."buyBoxWinner" AS "listingBuyBoxWinner",` : Prisma.empty}l.title AS "listingTitle",l.price AS "listingPrice",l."parentAsin" AS "listingParentAsin",l."mainImage" AS "listingMainImage"${domain === "performance" ? Prisma.sql`,COALESCE(NULLIF(l."mainImage",''),NULLIF(s."imageUrl",'')) AS "mainImageCandidate"` : Prisma.empty}
    FROM ${source} s JOIN "SellfoxStore" st ON st.id=s."storeId" AND ${scoped("st", scope)}
    ${Prisma.sql`LEFT JOIN LATERAL (SELECT candidate.* FROM listing candidate WHERE candidate."storeId"=s."storeId" AND ((s.msku IS NOT NULL AND candidate.msku=s.msku) OR (s.asin IS NOT NULL AND candidate.asin=s.asin)) ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1) l ON TRUE`} WHERE ${Prisma.join(filters, " AND ")})`;
  const safeSum = (key: string) => {
    const col = Prisma.raw(`"${key}"`);
    // Optional fees/refunds and profit quantities use null=0 at entity and currency-total levels.
    if (domain === "performance" && ["promotionDiscount", "giftWrapFee", "refundPrice", "refundNum", "commodityCost", "shippingPrice", "taxPrice", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "evaluationSaleNum", "channelSaleNum", "adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost", "fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount", "customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee", "promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount", "couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount", "fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount", "fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount", "evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"].includes(key)) return Prisma.sql`COALESCE(sum(${col}),0)::float`;
    return Prisma.sql`CASE WHEN count(${col})=count(*) THEN sum(${col})::float END`;
  };
  const aggregateColumns = domain === "performance" ? ["saleQuantity", "saleRevenue", "grossProfit", "adCost", "promotionDiscount", "giftWrapFee", "refundPrice", "refundNum", "commodityCost", "shippingPrice", "taxPrice", "headTripPrice", "avgPurchaseCost", "amazonCommissionPrice", "evaluationSaleNum", "channelSaleNum", "adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost", "fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount", "customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee", "promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount", "couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount", "fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount", "fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount", "evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount", "orderNum", "netRevenue", "fbaQuantity", "fbmQuantity"] : ["impressions", "clicks", "cost", "adOrders", "adSales"];
  const groups = domain === "sales" ? Prisma.sql`days AS (
    SELECT ${storeColumn},identity,currency,"reportDate",min(id) AS id,CASE WHEN count(DISTINCT asin)=1 THEN min(asin) END AS asin,CASE WHEN count(DISTINCT msku)=1 THEN min(msku) END AS msku,CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,
      ${["developer", "spu"].includes(dimension) ? Prisma.sql`min(identity) AS name` : Prisma.sql`min("storeName") AS name`},${marketplace} AS marketplace,CASE WHEN count("listingTitle")=count(*) AND count(DISTINCT "listingTitle")=1 THEN min("listingTitle") END AS title,CASE WHEN count("listingPrice")=count(*) AND count(DISTINCT "listingPrice")=1 THEN min("listingPrice") END AS price,CASE WHEN count("listingParentAsin")=count(*) AND count(DISTINCT "listingParentAsin")=1 THEN min("listingParentAsin") END AS "parentAsin",
      CASE WHEN count("listingBrand")=count(*) AND count(DISTINCT "listingBrand")=1 THEN min("listingBrand") END AS brand,
      CASE WHEN count("listingProductTags")=count(*) AND count(DISTINCT "listingProductTags")=1 THEN min("listingProductTags") END AS "productTags",
      min(NULLIF("listingMainImage",'')) AS "mainImage",
      CASE WHEN bool_and(complete AND orders IS NOT NULL) THEN sum(orders)::float END AS orders,
      CASE WHEN bool_and(complete AND quantity IS NOT NULL) THEN sum(quantity)::float END AS quantity,
      CASE WHEN bool_and(complete AND revenue IS NOT NULL) THEN sum(revenue)::float END AS revenue,
      array_agg(DISTINCT msku) AS members
    FROM base GROUP BY ${storeGrain}identity,currency,"reportDate"
  ), grouped AS (
    SELECT ${storeColumn},identity,currency,min(id) AS id,CASE WHEN count(DISTINCT asin)=1 THEN min(asin) END AS asin,CASE WHEN count(DISTINCT msku)=1 THEN min(msku) END AS msku,CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,min(name) AS name,${crossStore ? Prisma.sql`CASE WHEN count("storeId")=count(*) AND count(DISTINCT "storeId")=1 THEN min(marketplace) END` : Prisma.sql`min(marketplace)`} AS marketplace,CASE WHEN count(title)=count(*) AND count(DISTINCT title)=1 THEN min(title) END AS title,
      CASE WHEN count(price)=count(*) AND count(DISTINCT price)=1 THEN min(price) END AS price,CASE WHEN count("parentAsin")=count(*) AND count(DISTINCT "parentAsin")=1 THEN min("parentAsin") END AS "parentAsin",
      CASE WHEN count(brand)=count(*) AND count(DISTINCT brand)=1 THEN min(brand) END AS brand,
      CASE WHEN count("productTags")=count(*) AND count(DISTINCT "productTags")=1 THEN min("productTags") END AS "productTags",
      min(NULLIF("mainImage",'')) AS "mainImage",
      jsonb_object_agg("reportDate",quantity) AS "dailyQuantity",jsonb_object_agg("reportDate",${Prisma.raw(salesMetric)}) AS daily,
      ${query.metric === "orders" ? Prisma.sql`CASE WHEN count(*)=${workbenchDateRange(query).length} THEN ${safeSum(salesMetric)} END` : safeSum(salesMetric)} AS subtotal,${safeSum("quantity")} AS quantity,
      count(*)::int AS "observedDays",(SELECT array_agg(DISTINCT b.msku) FROM base b WHERE ${crossStore ? Prisma.empty : Prisma.sql`b."storeId"=days."storeId" AND `}b.identity=days.identity AND b.currency IS NOT DISTINCT FROM days.currency) AS members${crossStore ? Prisma.sql`,(SELECT jsonb_agg(DISTINCT jsonb_build_array(b."storeId",b.msku)) FROM base b WHERE b.identity=days.identity AND b.currency IS NOT DISTINCT FROM days.currency) AS "stockMembers"` : Prisma.empty}
    FROM days GROUP BY ${storeGrain}identity,currency
  )` : Prisma.sql`grouped AS (
    SELECT ${storeColumn},currency,${domain === "performance" ? Prisma.sql`identity` : adIdentity},
      ${domain === "ads_campaign" ? Prisma.sql`CASE WHEN count(DISTINCT "campaignName")=1 THEN min("campaignName") END AS "campaignName",` : domain === "ads_ad_group" ? Prisma.sql`CASE WHEN count(DISTINCT "adGroupName")=1 THEN min("adGroupName") END AS "adGroupName",` : domain === "ads_placement" ? Prisma.sql`CASE WHEN count("adGroupId")=count(*) AND count(DISTINCT "adGroupId")=1 THEN min("adGroupId") END AS "adGroupId",` : Prisma.empty}
      ${domain === "ads_targeting" || domain === "ads_search_term" || domain === "ads_ad_group" ? Prisma.sql`CASE WHEN count(DISTINCT "targetingText")=1 THEN min("targetingText") END AS "targetingText",CASE WHEN count(DISTINCT "matchType")=1 THEN min("matchType") END AS "matchType",` : Prisma.empty}min(id) AS id,min(asin) AS asin,min(msku) AS msku,${domain === "performance" ? Prisma.sql`min(NULLIF("mainImageCandidate",'')) AS "mainImage",CASE WHEN count(DISTINCT sku)=1 THEN min(sku) END AS sku,CASE WHEN count(DISTINCT title)=1 THEN min(title) END AS title,CASE WHEN count(DISTINCT "parentAsin")=1 THEN min("parentAsin") END AS "parentAsin",CASE WHEN count(*)=1 THEN min("refundRate") END AS "refundRate",` : Prisma.sql`min("listingTitle") AS title,min("listingPrice") AS price,
        min(NULLIF("listingMainImage",'')) AS "mainImage",
        CASE WHEN count("listingRating")=count(*) AND count(DISTINCT "listingRating")=1 THEN min("listingRating") END AS rating,
        CASE WHEN count("listingRatingCount")=count(*) AND count(DISTINCT "listingRatingCount")=1 THEN min("listingRatingCount") END AS "ratingCount",
        CASE WHEN count("listingProductTags")=count(*) AND count(DISTINCT "listingProductTags")=1 THEN min("listingProductTags") END AS "productTags",
        CASE WHEN count("listingBrand")=count(*) AND count(DISTINCT "listingBrand")=1 THEN min("listingBrand") END AS brand,
        CASE WHEN count("listingFulfillment")=count(*) AND count(DISTINCT "listingFulfillment")=1 THEN min("listingFulfillment") END AS fulfillment,
        CASE WHEN count("listingBuyBoxWinner")=count(*) AND count(DISTINCT "listingBuyBoxWinner")=1 THEN min("listingBuyBoxWinner") END AS "buyBoxWinner",`}
      ${domain === "performance" && ["developer", "spu"].includes(dimension) ? Prisma.sql`min(identity) AS name` : Prisma.sql`min("storeName") AS name`},${marketplace} AS marketplace,array_agg(DISTINCT msku) AS members,${crossStore ? Prisma.sql`jsonb_agg(DISTINCT jsonb_build_array("storeId",msku)) AS "stockMembers",` : Prisma.empty}
      ${Prisma.join(aggregateColumns.map(key => Prisma.sql`${safeSum(key)} AS ${Prisma.raw(`"${key}"`)}`))}
    FROM base GROUP BY ${crossStore ? Prisma.sql`identity,currency` : Prisma.sql`"storeId",currency,${domain === "performance" ? Prisma.sql`identity` : adIdentity}`}
  )`;
  // Aggregate names separately; unnest never expands monetary/quantity fact rows.
  const names = domain === "performance" ? Prisma.sql`,salesperson_names AS (
    SELECT ${storeGrain}identity,currency,array_agg(DISTINCT person.name ORDER BY person.name) AS "userNameList"
    FROM base CROSS JOIN LATERAL unnest("userNameList") person(name)
    GROUP BY ${storeGrain}identity,currency
  ), enriched AS (
    SELECT g.*,COALESCE(n."userNameList",ARRAY[]::text[]) AS "userNameList" FROM grouped g
    LEFT JOIN salesperson_names n ON n.identity=g.identity AND n.currency IS NOT DISTINCT FROM g.currency
      ${crossStore ? Prisma.empty : Prisma.sql`AND n."storeId"=g."storeId"`}
  )` : Prisma.empty;
  const finalFilters = [Prisma.sql`true`];
  if (domain === "sales" && query.hideZero) finalFilters.push(Prisma.sql`quantity IS DISTINCT FROM 0`);
  if (ads && query.quickFilter === "spend") finalFilters.push(Prisma.sql`cost>0`);
  if (ads && query.quickFilter === "clicksNoOrders") finalFilters.push(Prisma.sql`clicks>0 AND "adOrders"=0`);
  if (ads && query.quickFilter === "spendNoClicks") finalFilters.push(Prisma.sql`cost>0 AND clicks=0`);
  if (ads && query.quickFilter === "noClicks") finalFilters.push(Prisma.sql`clicks=0`);
  const dailyTotals = domain === "sales" ? Prisma.sql`,(SELECT jsonb_object_agg(d.date,d.value) FROM (SELECT day.date,CASE WHEN count(day.value)=count(*) AND count(*)=(SELECT count(*) FROM filtered f WHERE f.currency IS NOT DISTINCT FROM filtered.currency) THEN sum(day.value::float) END AS value FROM filtered fday CROSS JOIN LATERAL jsonb_each_text(fday.daily) day(date,value) WHERE fday.currency IS NOT DISTINCT FROM filtered.currency GROUP BY day.date) d) AS daily` : Prisma.empty;
  const totalKeys = domain === "sales" ? ["subtotal"] : aggregateColumns;
  const totals = Prisma.sql`(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM (SELECT currency,${totalKeys.length ? Prisma.join(totalKeys.map(key => Prisma.sql`${safeSum(key)} AS ${Prisma.raw(`"${key}"`)}`)) : Prisma.sql`count(*)::int AS count`}  ${dailyTotals} FROM filtered GROUP BY currency) t)`;
  // Facets ignore brand/tag/search/status so selections never remove other options.
  // Read typed current columns independently so facets neither materialize the main Listing CTE
  // nor force per-Listing label arrays onto every report member. Sales uses the typed
  // display string for unanimous metadata; facets stay independent. Still one round trip.
  const facetFilters = [scoped("l", scope)];
  if (query.shopExternalIds.length) facetFilters.push(Prisma.sql`st."externalId" IN (${Prisma.join(query.shopExternalIds)})`);
  if (query.storeId) facetFilters.push(Prisma.sql`l."storeId"=${query.storeId}`);
  if (query.site) facetFilters.push(Prisma.sql`st.marketplace=${query.site}`);
  const facets = needTagFacets ? Prisma.sql`,jsonb_build_object('productTags',
    ARRAY(SELECT DISTINCT tag."labelName" FROM sellfox_listing_current l
      JOIN "SellfoxStore" st ON st.id=l."storeId" AND ${scoped("st", scope)}
      CROSS JOIN LATERAL unnest(l."productTagNames") tag("labelName")
      WHERE ${Prisma.join(facetFilters, " AND ")} ORDER BY tag."labelName")
    ,'brands', ARRAY(SELECT DISTINCT l.brand FROM sellfox_listing_current l
      JOIN "SellfoxStore" st ON st.id=l."storeId" AND ${scoped("st", scope)}
      WHERE ${Prisma.join(facetFilters, " AND ")} AND l.brand IS NOT NULL ORDER BY 1)
    ${domain === "performance" ? Prisma.sql`,'salespersons',ARRAY(
      SELECT DISTINCT person.name FROM "SellfoxProductDailySnapshot" s
      JOIN "SellfoxStore" st ON st.id=s."storeId" AND ${scoped("st", scope)}
      CROSS JOIN LATERAL unnest(s."userNameList") person(name)
      WHERE ${Prisma.join(salespersonFacetFilters, " AND ")} ORDER BY person.name)` : Prisma.empty}) AS facets` : Prisma.empty;
  return Prisma.sql`WITH ${listing},${base},${groups}${names}, filtered AS (SELECT * FROM ${domain === "performance" ? Prisma.sql`enriched` : Prisma.sql`grouped`} WHERE ${Prisma.join(finalFilters, " AND ")})
    SELECT (SELECT count(*)::int FROM filtered) AS total,${totals} AS totals,
      COALESCE((SELECT jsonb_agg(p) FROM (SELECT * FROM filtered ORDER BY ${order} LIMIT ${exporting ? sellfoxExportLimit + 1 : query.pageSize} OFFSET ${exporting ? 0 : (query.page - 1) * query.pageSize}) p),'[]'::jsonb) AS rows${facets}`;
}
export async function readSellfoxWorkbench(domain: WorkbenchDomain, query: SellfoxBrowseQuery, scope: Scope, exporting = false) {
  if (domain === "sales" || domain === "performance") query = await resolveEffectiveReportDate(domain, query, scope);
  const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(domain);
  const result = await prisma.$queryRaw<{ total: number; rows: Row[]; totals: Row[]; facets?: { productTags: string[]; brands?: string[]; dxmPublishStates?: string[]; bsrCategories?: string[]; salespersons?: string[] } }[]>(workbenchReadSql(domain, query, scope, exporting));
  const { rows, total, totals, facets } = result[0];
  if (exporting && total > sellfoxExportLimit) throw new SellfoxBrowseError("筛选结果超过10,000条，请缩小范围；未导出部分文件。", 413);
  // Page-bounded supplemental lookup, never one network call per entity or full payload reads.
  // Exact source pairs avoid attributing an MSKU to unrelated stores on the page.
  // DISTINCT in SQL also prevents counting the same stock once per report day.
  const crossStore = (domain === "sales" || domain === "performance") && ["developer", "spu"].includes(query.dimension);
  const memberPairs = (row: Row): unknown[][] => crossStore && Array.isArray(row.stockMembers)
    ? row.stockMembers
    : (Array.isArray(row.members) ? row.members : [row.msku]).map(msku => [row.storeId, msku]);
  const stores = [...new Set(rows.flatMap(row => memberPairs(row).flatMap(([storeId]) => storeId == null ? [] : [String(storeId)])))];
  const mskus = [...new Set(rows.flatMap(row => Array.isArray(row.members) ? row.members.map(String) : row.msku ? [String(row.msku)] : []))];
  const inventory = stores.length ? await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT "storeId",msku,CASE WHEN count(quantity)=count(*) THEN sum(quantity)::float END AS fulfillable,CASE WHEN count("totalInventory")=count(*) THEN sum("totalInventory")::float END AS "totalInventory",max("capturedAt") AS "inventoryCapturedAt" FROM sellfox_inventory_current i WHERE ${scoped("i", scope)} AND "storeId" IN (${Prisma.join(stores)}) AND msku IN (${Prisma.join(mskus.length ? mskus : ["\u0001"])}) GROUP BY "storeId",msku`) : [];
  const stocksByKey = new Map(inventory.map(stock => [JSON.stringify([stock.storeId, stock.msku]), stock]));
  // Profit ranges are not day matrices: preserve open-ended/all-history reads
  // and do not impose the sales matrix's 90-day limit on their date metadata.
  const dates = domain === "sales" ? workbenchDateRange(query) : domain === "performance"
    ? query.from || query.to ? dateSpan(query.from || query.to!, query.to || query.from!) : query.reportDate ? [query.reportDate] : []
    : [];
  for (const row of rows) {
    const pairs = memberPairs(row);
    const stocks = pairs.flatMap(pair => { const stock = stocksByKey.get(JSON.stringify(pair)); return stock ? [stock] : []; });
    delete row.stockMembers;
    if (["sales", "performance"].includes(domain) && pairs.length > 1) row.msku = null;
    if (["sales", "performance"].includes(domain) && ["store", "developer", "spu"].includes(query.dimension)) {
      // Group by stable store or Listing identity in SQL; show its display label.
      row.identity = row.name;
      if (pairs.length > 1) for (const key of ["asin", "sku", "parentAsin", "title"]) row[key] = null;
    }
    for (const key of (domain === "listings" ? ["totalInventory"] : ["fulfillable", "totalInventory"])) row[key] = stocks.length === pairs.length && stocks.length > 0 && stocks.every(s => s[key] != null) ? stocks.reduce((sum, s) => sum + Number(s[key]), 0) : null;
    row.inventoryCapturedAt = stocks[0]?.inventoryCapturedAt ?? null;
    if (domain === "sales") { for (const date of dates) row[`day:${date}`] = (row.daily as Row)?.[date] ?? null;
      const values = dates.slice(-7).map(date => (row.dailyQuantity as Row)?.[date]);
      row.trend = values.length === 7 && values.every(v => v != null) ? values.join(" | ") : null;
      row.average7 = values.length === 7 && values.every(v => v != null) ? values.reduce<number>((n,v) => n + Number(v),0) / 7 : null;
    }
    if (domain === "performance") {
      row.grossProfitRate = row.grossProfit != null && Number(row.saleRevenue) > 0 ? Number(row.grossProfit) / Number(row.saleRevenue) : null;
      row.netProfitRate = row.grossProfit != null && Number(row.netRevenue) > 0 ? Number(row.grossProfit) / Number(row.netRevenue) : null;
    }
    if (ads) {
      row.acos = row.cost != null && Number(row.adSales) > 0 ? Number(row.cost) / Number(row.adSales) : null;
      row.roas = row.adSales != null && Number(row.cost) > 0 ? Number(row.adSales) / Number(row.cost) : null;
    }
  }
  return { rows, dates, totals, ...(facets ? { facets } : {}), pagination: { page: query.page, pageSize: query.pageSize, total } };
}
