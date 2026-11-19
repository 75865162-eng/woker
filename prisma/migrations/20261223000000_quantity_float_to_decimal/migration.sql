-- 数量字段 Float(double precision) -> Decimal(20,4)，消除库存/销量的浮点精度风险。
-- 依赖视图需先 DROP，改列类型后按最新定义重建（沿用金额迁移 20261118050000 的模式）。
-- sellfox_profit_daily 引用 SellfoxProductDailySnapshot 数量列；
-- sellfox_listing_current 引用 SellfoxListingSnapshot 数量列；
-- SellfoxListingProfile 为平铺表，无视图依赖。

DROP VIEW IF EXISTS "sellfox_profit_daily";
DROP VIEW IF EXISTS "sellfox_listing_current";

ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "refundNum" TYPE DECIMAL(20,4) USING "refundNum"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "evaluationSaleNum" TYPE DECIMAL(20,4) USING "evaluationSaleNum"::numeric(20,4);
ALTER TABLE "SellfoxProductDailySnapshot" ALTER COLUMN "channelSaleNum" TYPE DECIMAL(20,4) USING "channelSaleNum"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "reservedQty" TYPE DECIMAL(20,4) USING "reservedQty"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "listingQuantity" TYPE DECIMAL(20,4) USING "listingQuantity"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "unsellable" TYPE DECIMAL(20,4) USING "unsellable"::numeric(20,4);
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "warehousing" TYPE DECIMAL(20,4) USING "warehousing"::numeric(20,4);
ALTER TABLE "SellfoxListingProfile" ALTER COLUMN "reservedQty" TYPE DECIMAL(20,4) USING "reservedQty"::numeric(20,4);
ALTER TABLE "SellfoxListingProfile" ALTER COLUMN "listingQuantity" TYPE DECIMAL(20,4) USING "listingQuantity"::numeric(20,4);
ALTER TABLE "SellfoxListingProfile" ALTER COLUMN "unsellable" TYPE DECIMAL(20,4) USING "unsellable"::numeric(20,4);
ALTER TABLE "SellfoxListingProfile" ALTER COLUMN "warehousing" TYPE DECIMAL(20,4) USING "warehousing"::numeric(20,4);

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

CREATE OR REPLACE VIEW sellfox_listing_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."capturedAt", t."asin", t."msku", t."sku", t."parentAsin", t."title", t."status", t."price", t."currency", t."fulfillable", t."sales7", t."sales14", t."sales30", t."revenue7", t."revenue14", t."revenue30", t."adSpend7", t."adSpend14", t."adSpend30", t."sourceUpdatedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."fnsku", t."parentSku", t."mainImage", t."brand", t."amazonBrand", t."productTags", t."openDate", t."firstSaleDate", t."bsrCategory", t."buyBoxWinner", t."fulfillment", t."rating", t."ratingCount", t."bsrRank", t."purchaseCost", t."fbaFees", t."referralFee", t."totalFee", t."headTripCost", t."reservedQty", t."shippingPrice", t."profitPrice", t."profitRate", t."listingQuantity", t."unsellable", t."warehousing", t."productTagNames", t."ratingValue", t."dxmPublishState", t."developer", t."spu", t."promoPrice" FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" AND s."organizationId"=t."organizationId" AND s."workspaceId"=t."workspaceId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='listings' AND h."capturedAt"=t."capturedAt";
