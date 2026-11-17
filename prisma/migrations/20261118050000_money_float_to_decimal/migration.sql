-- 依赖金额列的视图先删除，列类型变更后按原定义重建
DROP VIEW IF EXISTS "sellfox_ads_ad_group_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_ads_campaign_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_ads_placement_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_ads_product_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_ads_search_term_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_ads_targeting_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_inventory_current" CASCADE;
DROP VIEW IF EXISTS "sellfox_listing_current" CASCADE;
DROP VIEW IF EXISTS "sellfox_profit_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_sales_daily" CASCADE;
DROP VIEW IF EXISTS "sellfox_sales_day_coverage" CASCADE;

ALTER TABLE "ProductRecord" ALTER COLUMN "purchasePrice" TYPE DECIMAL(20,4) USING "purchasePrice"::numeric(20,4);
ALTER TABLE "ProductListing" ALTER COLUMN "price" TYPE DECIMAL(20,4) USING "price"::numeric(20,4);
ALTER TABLE "ProductCost" ALTER COLUMN "amount" TYPE DECIMAL(20,4) USING "amount"::numeric(20,4);
ALTER TABLE "ProductSummaryRecord" ALTER COLUMN "purchasePrice" TYPE DECIMAL(20,4) USING "purchasePrice"::numeric(20,4);
ALTER TABLE "SellfoxHourlyMetric" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxHourlyMetric" ALTER COLUMN "sales" TYPE DECIMAL(20,4) USING "sales"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "netRevenue" TYPE DECIMAL(20,4) USING "netRevenue"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "saleRevenue" TYPE DECIMAL(20,4) USING "saleRevenue"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "grossProfit" TYPE DECIMAL(20,4) USING "grossProfit"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adCost" TYPE DECIMAL(20,4) USING "adCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "promotionDiscount" TYPE DECIMAL(20,4) USING "promotionDiscount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "giftWrapFee" TYPE DECIMAL(20,4) USING "giftWrapFee"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "refundPrice" TYPE DECIMAL(20,4) USING "refundPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "commodityCost" TYPE DECIMAL(20,4) USING "commodityCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "shippingPrice" TYPE DECIMAL(20,4) USING "shippingPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "taxPrice" TYPE DECIMAL(20,4) USING "taxPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "headTripPrice" TYPE DECIMAL(20,4) USING "headTripPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "avgPurchaseCost" TYPE DECIMAL(20,4) USING "avgPurchaseCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "amazonCommissionPrice" TYPE DECIMAL(20,4) USING "amazonCommissionPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaStorageFeeAmount" TYPE DECIMAL(20,4) USING "fbaStorageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaLongTermStorageFeeAmount" TYPE DECIMAL(20,4) USING "fbaLongTermStorageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaRemovalFeeAmount" TYPE DECIMAL(20,4) USING "fbaRemovalFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaDisposalFeeAmount" TYPE DECIMAL(20,4) USING "fbaDisposalFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "customAsinFee" TYPE DECIMAL(20,4) USING "customAsinFee"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "customShopFee" TYPE DECIMAL(20,4) USING "customShopFee"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "serviceFeeAmount" TYPE DECIMAL(20,4) USING "serviceFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "storageFeeAmount" TYPE DECIMAL(20,4) USING "storageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "compensationAmount" TYPE DECIMAL(20,4) USING "compensationAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "evaluationFee" TYPE DECIMAL(20,4) USING "evaluationFee"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "promotionTotalAmount" TYPE DECIMAL(20,4) USING "promotionTotalAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaOverageFeeAmount" TYPE DECIMAL(20,4) USING "fbaOverageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "chargebackAmount" TYPE DECIMAL(20,4) USING "chargebackAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "guaranteeClaimAmount" TYPE DECIMAL(20,4) USING "guaranteeClaimAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "digitalServicesFeeAmount" TYPE DECIMAL(20,4) USING "digitalServicesFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "otherPriceAmount" TYPE DECIMAL(20,4) USING "otherPriceAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "shippingChargeAmount" TYPE DECIMAL(20,4) USING "shippingChargeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "regulatoryFeeAmount" TYPE DECIMAL(20,4) USING "regulatoryFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "couponPaymentAmount" TYPE DECIMAL(20,4) USING "couponPaymentAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "sellerDealPaymentAmount" TYPE DECIMAL(20,4) USING "sellerDealPaymentAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "vineFeeAmount" TYPE DECIMAL(20,4) USING "vineFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "starStorageFeeAmount" TYPE DECIMAL(20,4) USING "starStorageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "subscriptionAmount" TYPE DECIMAL(20,4) USING "subscriptionAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaCustomerReturnAmount" TYPE DECIMAL(20,4) USING "fbaCustomerReturnAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaInboundConvenienceFeeAmount" TYPE DECIMAL(20,4) USING "fbaInboundConvenienceFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "inboundTransportationFeeAmount" TYPE DECIMAL(20,4) USING "inboundTransportationFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "shippingChargebackAmount" TYPE DECIMAL(20,4) USING "shippingChargebackAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "giftwrapChargebackAmount" TYPE DECIMAL(20,4) USING "giftwrapChargebackAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "costOfPointsGrantedAmount" TYPE DECIMAL(20,4) USING "costOfPointsGrantedAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "orderOtherPriceAmount" TYPE DECIMAL(20,4) USING "orderOtherPriceAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaInboundTransportationProgramFee" TYPE DECIMAL(20,4) USING "fbaInboundTransportationProgramFee"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "aglFeeAmount" TYPE DECIMAL(20,4) USING "aglFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "paidServicesFeeAmount" TYPE DECIMAL(20,4) USING "paidServicesFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "customerReturnHrrUnitFeeAmount" TYPE DECIMAL(20,4) USING "customerReturnHrrUnitFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "amazonUpstreamStorageTransportationFeeAmount" TYPE DECIMAL(20,4) USING "amazonUpstreamStorageTransportationFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "amazonUpstreamProcessingFeeAmount" TYPE DECIMAL(20,4) USING "amazonUpstreamProcessingFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "mfnPostageFeeAmount" TYPE DECIMAL(20,4) USING "mfnPostageFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adjustmentFeeAmount" TYPE DECIMAL(20,4) USING "adjustmentFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "otherServiceFeeAmount" TYPE DECIMAL(20,4) USING "otherServiceFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "avgHeadTripPrice" TYPE DECIMAL(20,4) USING "avgHeadTripPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "purchaseRefundPrice" TYPE DECIMAL(20,4) USING "purchaseRefundPrice"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "revenueAmount" TYPE DECIMAL(20,4) USING "revenueAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaPerUnitFulfillmentFeeRefundAmount" TYPE DECIMAL(20,4) USING "fbaPerUnitFulfillmentFeeRefundAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fbaWeightBasedFeeRefundAmount" TYPE DECIMAL(20,4) USING "fbaWeightBasedFeeRefundAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "deferredAmount" TYPE DECIMAL(20,4) USING "deferredAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "withheldTaxAmount" TYPE DECIMAL(20,4) USING "withheldTaxAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "otherPriceIncomeAmount" TYPE DECIMAL(20,4) USING "otherPriceIncomeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "paymentMethodFeeAmount" TYPE DECIMAL(20,4) USING "paymentMethodFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "fixedClosingFeeAmount" TYPE DECIMAL(20,4) USING "fixedClosingFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "variableClosingFeeAmount" TYPE DECIMAL(20,4) USING "variableClosingFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "imagingServicesFeeAmount" TYPE DECIMAL(20,4) USING "imagingServicesFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "netCoAmount" TYPE DECIMAL(20,4) USING "netCoAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "comminglingVatAmount" TYPE DECIMAL(20,4) USING "comminglingVatAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "codFeeAmount" TYPE DECIMAL(20,4) USING "codFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "evaluationCapital" TYPE DECIMAL(20,4) USING "evaluationCapital"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "evaluationCommission" TYPE DECIMAL(20,4) USING "evaluationCommission"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "dealPerformanceFeeAmount" TYPE DECIMAL(20,4) USING "dealPerformanceFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "couponParticipationFeeAmount" TYPE DECIMAL(20,4) USING "couponParticipationFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "safetReimbursedAmount" TYPE DECIMAL(20,4) USING "safetReimbursedAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "affordabilityExpenseAmount" TYPE DECIMAL(20,4) USING "affordabilityExpenseAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "withheldFeeAmount" TYPE DECIMAL(20,4) USING "withheldFeeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "chargebackIncomeAmount" TYPE DECIMAL(20,4) USING "chargebackIncomeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "guaranteeClaimIncomeAmount" TYPE DECIMAL(20,4) USING "guaranteeClaimIncomeAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "promotionSalesAmount" TYPE DECIMAL(20,4) USING "promotionSalesAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "promotionShippingAmount" TYPE DECIMAL(20,4) USING "promotionShippingAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "promotionTaxAmount" TYPE DECIMAL(20,4) USING "promotionTaxAmount"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adSpCost" TYPE DECIMAL(20,4) USING "adSpCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adSdCost" TYPE DECIMAL(20,4) USING "adSdCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adSbCost" TYPE DECIMAL(20,4) USING "adSbCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adSbvCost" TYPE DECIMAL(20,4) USING "adSbvCost"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "adSbsCost" TYPE DECIMAL(20,4) USING "adSbsCost"::numeric(20,4);
ALTER TABLE "SellfoxFbaInventorySnapshot" ALTER COLUMN "avgInventoryCost" TYPE DECIMAL(20,4) USING "avgInventoryCost"::numeric(20,4);
ALTER TABLE "SellfoxFbaInventorySnapshot" ALTER COLUMN "avgTransportCost" TYPE DECIMAL(20,4) USING "avgTransportCost"::numeric(20,4);
ALTER TABLE "SellfoxSalesDailySnapshot" ALTER COLUMN "revenue" TYPE DECIMAL(20,4) USING "revenue"::numeric(20,4);
ALTER TABLE "SellfoxOrderSnapshot" ALTER COLUMN "orderTotal" TYPE DECIMAL(20,4) USING "orderTotal"::numeric(20,4);
ALTER TABLE "SellfoxOrderSnapshot" ALTER COLUMN "itemAmount" TYPE DECIMAL(20,4) USING "itemAmount"::numeric(20,4);
ALTER TABLE "SellfoxOrderSnapshot" ALTER COLUMN "revenue" TYPE DECIMAL(20,4) USING "revenue"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "price" TYPE DECIMAL(20,4) USING "price"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "revenue7" TYPE DECIMAL(20,4) USING "revenue7"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "revenue14" TYPE DECIMAL(20,4) USING "revenue14"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "revenue30" TYPE DECIMAL(20,4) USING "revenue30"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "adSpend7" TYPE DECIMAL(20,4) USING "adSpend7"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "adSpend14" TYPE DECIMAL(20,4) USING "adSpend14"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "adSpend30" TYPE DECIMAL(20,4) USING "adSpend30"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "purchaseCost" TYPE DECIMAL(20,4) USING "purchaseCost"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "fbaFees" TYPE DECIMAL(20,4) USING "fbaFees"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "referralFee" TYPE DECIMAL(20,4) USING "referralFee"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "totalFee" TYPE DECIMAL(20,4) USING "totalFee"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "headTripCost" TYPE DECIMAL(20,4) USING "headTripCost"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "shippingPrice" TYPE DECIMAL(20,4) USING "shippingPrice"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "profitPrice" TYPE DECIMAL(20,4) USING "profitPrice"::numeric(20,4);
ALTER TABLE "SellfoxAdsProductDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsProductDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "SellfoxAdsTargetingDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsTargetingDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "SellfoxAdsSearchTermDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsSearchTermDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "SellfoxAdsCampaignDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsCampaignDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "SellfoxAdsAdGroupDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsAdGroupDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "SellfoxAdsPlacementDaily" ALTER COLUMN "cost" TYPE DECIMAL(20,4) USING "cost"::numeric(20,4);
ALTER TABLE "SellfoxAdsPlacementDaily" ALTER COLUMN "adSales" TYPE DECIMAL(20,4) USING "adSales"::numeric(20,4);
ALTER TABLE "ProductRecord" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE "ProductSummaryRecord" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE "SellfoxHourlyMetric" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'CNY';

CREATE VIEW "sellfox_ads_ad_group_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t."adGroupId",
    t."adGroupName",
    t."targetingText",
    t."matchType",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsAdGroupDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_ads_campaign_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t."campaignName",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsCampaignDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_ads_placement_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t.placement,
    t."adGroupId",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsPlacementDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_ads_product_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t."adGroupId",
    t."productId",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsProductDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_ads_search_term_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t."adGroupId",
    t."searchTerm",
    t."targetingId",
    t."targetingText",
    t."matchType",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsSearchTermDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_ads_targeting_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."reportDate",
    t."adType",
    t."campaignId",
    t."adGroupId",
    t."targetingId",
    t."targetingText",
    t."matchType",
    t.asin,
    t.msku,
    t.currency,
    t.impressions,
    t.clicks,
    t.cost,
    t."adOrders",
    t."adSales",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
        CASE
            WHEN (t."adSales" > (0)::double precision) THEN (t.cost / t."adSales")
            ELSE NULL::double precision
        END AS acos,
        CASE
            WHEN (t.cost > (0)::double precision) THEN (t."adSales" / t.cost)
            ELSE NULL::double precision
        END AS roas
   FROM ("SellfoxAdsTargetingDaily" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_inventory_current" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."sourceKey",
    t."reportDate",
    t."capturedAt",
    t.asin,
    t.msku,
    t.sku,
    t.fnsku,
    t.quantity,
    t."totalInventory",
    t."inTransit",
    t."inboundWorking",
    t."inboundShipped",
    t."inboundReceiving",
    t."reservedTransfer",
    t."reservedProcessing",
    t."reservedCustomerorders",
    t.unfulfillable,
    t."warehouseName",
    t."commodityName",
    t.currency,
    t."avgInventoryCost",
    t."avgTransportCost",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace
   FROM (("SellfoxFbaInventorySnapshot" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")))
     JOIN "SellfoxSnapshotHead" h ON (((h."storeId" = t."storeId") AND (h.resource = 'inventory'::text) AND (h."capturedAt" = t."capturedAt"))));
CREATE VIEW "sellfox_listing_current" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."sourceKey",
    t."capturedAt",
    t.asin,
    t.msku,
    t.sku,
    t."parentAsin",
    t.title,
    t.status,
    t.price,
    t.currency,
    t.fulfillable,
    t.sales7,
    t.sales14,
    t.sales30,
    t.revenue7,
    t.revenue14,
    t.revenue30,
    t."adSpend7",
    t."adSpend14",
    t."adSpend30",
    t."sourceUpdatedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
    t.fnsku,
    t."parentSku",
    t."mainImage",
    t.brand,
    t."amazonBrand",
    t."productTags",
    t."openDate",
    t."firstSaleDate",
    t."bsrCategory",
    t."buyBoxWinner",
    t.fulfillment,
    t.rating,
    t."ratingCount",
    t."bsrRank",
    t."purchaseCost",
    t."fbaFees",
    t."referralFee",
    t."totalFee",
    t."headTripCost",
    t."reservedQty",
    t."shippingPrice",
    t."profitPrice",
    t."profitRate",
    t."listingQuantity",
    t.unsellable,
    t.warehousing,
    t."productTagNames",
    t."ratingValue",
    t."dxmPublishState",
    t.developer,
    t.spu
   FROM (("SellfoxListingSnapshot" t
     JOIN "SellfoxStore" s ON (((s.id = t."storeId") AND (s."organizationId" = t."organizationId") AND (s."workspaceId" = t."workspaceId"))))
     JOIN "SellfoxSnapshotHead" h ON (((h."storeId" = t."storeId") AND (h.resource = 'listings'::text) AND (h."capturedAt" = t."capturedAt"))));
CREATE VIEW "sellfox_profit_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."sourceKey",
    t."reportDate",
    t.asin,
    t.msku,
    t.sku,
    t.title,
    t.currency,
    t."saleQuantity",
    t."saleRevenue",
    t."grossProfit",
    t."grossProfitRate",
    t."adCost",
    t."refundRate",
    t."orderNum",
    t."netRevenue",
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
    t."onlySettle",
    t."promotionDiscount",
    t."giftWrapFee",
    t."imageUrl",
    t."refundPrice",
    t."refundNum",
    t."commodityCost",
    t."shippingPrice",
    t."taxPrice",
    t."userNameList",
    t."headTripPrice",
    t."avgPurchaseCost",
    t."amazonCommissionPrice",
    t."evaluationSaleNum",
    t."channelSaleNum",
    t."adSpCost",
    t."adSdCost",
    t."adSbCost",
    t."adSbvCost",
    t."adSbsCost",
    t."fbaStorageFeeAmount",
    t."fbaLongTermStorageFeeAmount",
    t."fbaRemovalFeeAmount",
    t."fbaDisposalFeeAmount",
    t."customAsinFee",
    t."customShopFee",
    t."serviceFeeAmount",
    t."storageFeeAmount",
    t."compensationAmount",
    t."evaluationFee",
    t."promotionTotalAmount",
    t."fbaOverageFeeAmount",
    t."chargebackAmount",
    t."guaranteeClaimAmount",
    t."digitalServicesFeeAmount",
    t."otherPriceAmount",
    t."shippingChargeAmount",
    t."regulatoryFeeAmount",
    t."couponPaymentAmount",
    t."sellerDealPaymentAmount",
    t."vineFeeAmount",
    t."starStorageFeeAmount",
    t."subscriptionAmount",
    t."fbaCustomerReturnAmount",
    t."fbaInboundConvenienceFeeAmount",
    t."inboundTransportationFeeAmount",
    t."shippingChargebackAmount",
    t."giftwrapChargebackAmount",
    t."costOfPointsGrantedAmount",
    t."orderOtherPriceAmount",
    t."fbaInboundTransportationProgramFee",
    t."aglFeeAmount",
    t."paidServicesFeeAmount",
    t."customerReturnHrrUnitFeeAmount",
    t."amazonUpstreamStorageTransportationFeeAmount",
    t."amazonUpstreamProcessingFeeAmount",
    t."mfnPostageFeeAmount",
    t."adjustmentFeeAmount",
    t."otherServiceFeeAmount",
    t."avgHeadTripPrice",
    t."purchaseRefundPrice",
    t."revenueAmount",
    t."fbaPerUnitFulfillmentFeeRefundAmount",
    t."fbaWeightBasedFeeRefundAmount",
    t."deferredAmount",
    t."withheldTaxAmount",
    t."otherPriceIncomeAmount",
    t."paymentMethodFeeAmount",
    t."fixedClosingFeeAmount",
    t."variableClosingFeeAmount",
    t."imagingServicesFeeAmount",
    t."netCoAmount",
    t."comminglingVatAmount",
    t."codFeeAmount",
    t."evaluationCapital",
    t."evaluationCommission",
    t."dealPerformanceFeeAmount",
    t."couponParticipationFeeAmount",
    t."safetReimbursedAmount",
    t."affordabilityExpenseAmount",
    t."withheldFeeAmount",
    t."chargebackIncomeAmount",
    t."guaranteeClaimIncomeAmount",
    t."promotionSalesAmount",
    t."promotionShippingAmount",
    t."promotionTaxAmount"
   FROM ("SellfoxProductDailySnapshot" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_sales_daily" AS SELECT t.id,
    t."organizationId",
    t."workspaceId",
    t."storeId",
    t."sourceKey",
    t."reportDate",
    t.asin,
    t.msku,
    t.sku,
    t.quantity,
    t.revenue,
    t.currency,
    t."syncedAt",
    s."externalId" AS "shopExternalId",
    s.name,
    s.marketplace,
    (EXISTS ( SELECT 1
           FROM "SellfoxSalesDayCoverage" c
          WHERE ((c."storeId" = t."storeId") AND (c."reportDate" = t."reportDate") AND (c."capturedAt" = t."syncedAt")))) AS complete,
    t.orders
   FROM ("SellfoxSalesDailySnapshot" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
CREATE VIEW "sellfox_sales_day_coverage" AS SELECT s."organizationId",
    s."workspaceId",
    s."externalId" AS "shopExternalId",
    c."storeId",
    c."reportDate",
    c."capturedAt",
    c."rowWrites"
   FROM ("SellfoxSalesDayCoverage" c
     JOIN "SellfoxStore" s ON ((s.id = c."storeId")));
