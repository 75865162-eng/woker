-- Fee-mining wrap batch. Preserve all 180000 projections and view columns; append only.
BEGIN;
ALTER TABLE "SellfoxProductDailySnapshot"
  ADD COLUMN "evaluationCapital" DOUBLE PRECISION,
  ADD COLUMN "evaluationCommission" DOUBLE PRECISION,
  ADD COLUMN "dealPerformanceFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "couponParticipationFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "safetReimbursedAmount" DOUBLE PRECISION,
  ADD COLUMN "affordabilityExpenseAmount" DOUBLE PRECISION,
  ADD COLUMN "withheldFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "chargebackIncomeAmount" DOUBLE PRECISION,
  ADD COLUMN "guaranteeClaimIncomeAmount" DOUBLE PRECISION,
  ADD COLUMN "promotionSalesAmount" DOUBLE PRECISION,
  ADD COLUMN "promotionShippingAmount" DOUBLE PRECISION,
  ADD COLUMN "promotionTaxAmount" DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION sellfox_product_daily_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."refundPrice" := sellfox_listing_number(NEW.payload->>'refundPrice');
  NEW."refundNum" := sellfox_listing_number(NEW.payload->>'refundNum');
  NEW."commodityCost" := sellfox_listing_number(NEW.payload->>'commodityCost');
  NEW."shippingPrice" := sellfox_listing_number(NEW.payload->>'shippingPrice');
  NEW."taxPrice" := sellfox_listing_number(NEW.payload->>'taxPrice');
  NEW."headTripPrice" := sellfox_listing_number(NEW.payload->>'headTripPrice');
  NEW."avgPurchaseCost" := sellfox_listing_number(NEW.payload->>'avgPurchaseCost');
  NEW."amazonCommissionPrice" := sellfox_listing_number(NEW.payload->>'amazonCommissionPrice');
  NEW."evaluationSaleNum" := sellfox_listing_number(NEW.payload->>'evaluationSaleNum');
  NEW."channelSaleNum" := sellfox_listing_number(NEW.payload->>'channelSaleNum');
  NEW."adSpCost" := sellfox_listing_number(NEW.payload->>'adSpCost');
  NEW."adSdCost" := sellfox_listing_number(NEW.payload->>'adSdCost');
  NEW."adSbCost" := sellfox_listing_number(NEW.payload->>'adSbCost');
  NEW."adSbvCost" := sellfox_listing_number(NEW.payload->>'adSbvCost');
  NEW."adSbsCost" := sellfox_listing_number(NEW.payload->>'adSbsCost');
  NEW."fbaStorageFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaStorageFeeAmount');
  NEW."fbaLongTermStorageFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaLongTermStorageFeeAmount');
  NEW."fbaRemovalFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaRemovalFeeAmount');
  NEW."fbaDisposalFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaDisposalFeeAmount');
  NEW."customAsinFee" := sellfox_listing_number(NEW.payload->>'customAsinFee');
  NEW."customShopFee" := sellfox_listing_number(NEW.payload->>'customShopFee');
  NEW."serviceFeeAmount" := sellfox_listing_number(NEW.payload->>'serviceFeeAmount');
  NEW."storageFeeAmount" := sellfox_listing_number(NEW.payload->>'storageFeeAmount');
  NEW."compensationAmount" := sellfox_listing_number(NEW.payload->>'compensationAmount');
  NEW."evaluationFee" := sellfox_listing_number(NEW.payload->>'evaluationFee');
  NEW."promotionTotalAmount" := sellfox_listing_number(NEW.payload->>'promotionTotalAmount');
  NEW."fbaOverageFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaOverageFeeAmount');
  NEW."chargebackAmount" := sellfox_listing_number(NEW.payload->>'chargebackAmount');
  NEW."guaranteeClaimAmount" := sellfox_listing_number(NEW.payload->>'guaranteeClaimAmount');
  NEW."digitalServicesFeeAmount" := sellfox_listing_number(NEW.payload->>'digitalServicesFeeAmount');
  NEW."otherPriceAmount" := sellfox_listing_number(NEW.payload->>'otherPriceAmount');
  NEW."shippingChargeAmount" := sellfox_listing_number(NEW.payload->>'shippingChargeAmount');
  NEW."regulatoryFeeAmount" := sellfox_listing_number(NEW.payload->>'regulatoryFeeAmount');
  NEW."couponPaymentAmount" := sellfox_listing_number(NEW.payload->>'couponPaymentAmount');
  NEW."sellerDealPaymentAmount" := sellfox_listing_number(NEW.payload->>'sellerDealPaymentAmount');
  NEW."vineFeeAmount" := sellfox_listing_number(NEW.payload->>'vineFeeAmount');
  NEW."starStorageFeeAmount" := sellfox_listing_number(NEW.payload->>'starStorageFeeAmount');
  NEW."subscriptionAmount" := sellfox_listing_number(NEW.payload->>'subscriptionAmount');
  NEW."fbaCustomerReturnAmount" := sellfox_listing_number(NEW.payload->>'fbaCustomerReturnAmount');
  NEW."fbaInboundConvenienceFeeAmount" := sellfox_listing_number(NEW.payload->>'fbaInboundConvenienceFeeAmount');
  NEW."inboundTransportationFeeAmount" := sellfox_listing_number(NEW.payload->>'inboundTransportationFeeAmount');
  NEW."shippingChargebackAmount" := sellfox_listing_number(NEW.payload->>'shippingChargebackAmount');
  NEW."giftwrapChargebackAmount" := sellfox_listing_number(NEW.payload->>'giftwrapChargebackAmount');
  NEW."costOfPointsGrantedAmount" := sellfox_listing_number(NEW.payload->>'costOfPointsGrantedAmount');
  NEW."orderOtherPriceAmount" := sellfox_listing_number(NEW.payload->>'orderOtherPriceAmount');
  NEW."fbaInboundTransportationProgramFee" := sellfox_listing_number(NEW.payload->>'fbaInboundTransportationProgramFee');
  NEW."aglFeeAmount" := sellfox_listing_number(NEW.payload->>'aglFeeAmount');
  NEW."paidServicesFeeAmount" := sellfox_listing_number(NEW.payload->>'paidServicesFeeAmount');
  NEW."customerReturnHrrUnitFeeAmount" := sellfox_listing_number(NEW.payload->>'customerReturnHrrUnitFeeAmount');
  NEW."amazonUpstreamStorageTransportationFeeAmount" := sellfox_listing_number(NEW.payload->>'amazonUpstreamStorageTransportationFeeAmount');
  NEW."amazonUpstreamProcessingFeeAmount" := sellfox_listing_number(NEW.payload->>'amazonUpstreamProcessingFeeAmount');
  NEW."mfnPostageFeeAmount" := sellfox_listing_number(NEW.payload->>'mfnPostageFeeAmount');
  NEW."adjustmentFeeAmount" := sellfox_listing_number(NEW.payload->>'adjustmentFeeAmount');
  NEW."otherServiceFeeAmount" := sellfox_listing_number(NEW.payload->>'otherServiceFeeAmount');
  NEW."avgHeadTripPrice" := sellfox_listing_number(NEW.payload->>'avgHeadTripPrice');
  NEW."purchaseRefundPrice" := sellfox_listing_number(NEW.payload->>'purchaseRefundPrice');
  NEW."revenueAmount" := sellfox_listing_number(NEW.payload->>'revenueAmount');
  NEW."fbaPerUnitFulfillmentFeeRefundAmount" := sellfox_listing_number(NEW.payload->>'fbaPerUnitFulfillmentFeeRefundAmount');
  NEW."fbaWeightBasedFeeRefundAmount" := sellfox_listing_number(NEW.payload->>'fbaWeightBasedFeeRefundAmount');
  NEW."deferredAmount" := sellfox_listing_number(NEW.payload->>'deferredAmount');
  NEW."withheldTaxAmount" := sellfox_listing_number(NEW.payload->>'withheldTaxAmount');
  NEW."otherPriceIncomeAmount" := sellfox_listing_number(NEW.payload->>'otherPriceIncomeAmount');
  NEW."paymentMethodFeeAmount" := sellfox_listing_number(NEW.payload->>'paymentMethodFeeAmount');
  NEW."fixedClosingFeeAmount" := sellfox_listing_number(NEW.payload->>'fixedClosingFeeAmount');
  NEW."variableClosingFeeAmount" := sellfox_listing_number(NEW.payload->>'variableClosingFeeAmount');
  NEW."imagingServicesFeeAmount" := sellfox_listing_number(NEW.payload->>'imagingServicesFeeAmount');
  NEW."netCoAmount" := sellfox_listing_number(NEW.payload->>'netCoAmount');
  NEW."comminglingVatAmount" := sellfox_listing_number(NEW.payload->>'comminglingVatAmount');
  NEW."codFeeAmount" := sellfox_listing_number(NEW.payload->>'codFeeAmount');
  NEW."evaluationCapital" := sellfox_listing_number(NEW.payload->>'evaluationCapital');
  NEW."evaluationCommission" := sellfox_listing_number(NEW.payload->>'evaluationCommission');
  NEW."dealPerformanceFeeAmount" := sellfox_listing_number(NEW.payload->>'dealPerformanceFeeAmount');
  NEW."couponParticipationFeeAmount" := sellfox_listing_number(NEW.payload->>'couponParticipationFeeAmount');
  NEW."safetReimbursedAmount" := sellfox_listing_number(NEW.payload->>'safetReimbursedAmount');
  NEW."affordabilityExpenseAmount" := sellfox_listing_number(NEW.payload->>'affordabilityExpenseAmount');
  NEW."withheldFeeAmount" := sellfox_listing_number(NEW.payload->>'withheldFeeAmount');
  NEW."chargebackIncomeAmount" := sellfox_listing_number(NEW.payload->>'chargebackIncomeAmount');
  NEW."guaranteeClaimIncomeAmount" := sellfox_listing_number(NEW.payload->>'guaranteeClaimIncomeAmount');
  NEW."promotionSalesAmount" := sellfox_listing_number(NEW.payload->>'promotionSalesAmount');
  NEW."promotionShippingAmount" := sellfox_listing_number(NEW.payload->>'promotionShippingAmount');
  NEW."promotionTaxAmount" := sellfox_listing_number(NEW.payload->>'promotionTaxAmount');
  -- Only string array members are names. Missing/scalar/object/null payload values stay empty.
  NEW."userNameList" := ARRAY(
    SELECT DISTINCT btrim(x #>> '{}')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.payload->'userNameList')='array'
      THEN NEW.payload->'userNameList' ELSE '[]'::jsonb END) AS t(x)
    WHERE jsonb_typeof(x)='string' AND btrim(x #>> '{}') <> ''
    ORDER BY 1
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sellfox_product_daily_project_write ON "SellfoxProductDailySnapshot";
CREATE TRIGGER sellfox_product_daily_project_write
BEFORE INSERT OR UPDATE OF payload ON "SellfoxProductDailySnapshot"
FOR EACH ROW EXECUTE FUNCTION sellfox_product_daily_project();

-- Backfill retained facts only; review historical lock/WAL/disk cost before real apply.
UPDATE "SellfoxProductDailySnapshot" SET payload=payload;

CREATE OR REPLACE VIEW sellfox_profit_daily AS SELECT
  t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."title", t."currency", t."saleQuantity", t."saleRevenue", t."grossProfit", t."grossProfitRate", t."adCost", t."refundRate", t."orderNum", t."netRevenue", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."onlySettle",
  t."promotionDiscount", t."giftWrapFee", t."imageUrl",
  t."refundPrice", t."refundNum", t."commodityCost", t."shippingPrice", t."taxPrice",
  t."userNameList",
  t."headTripPrice", t."avgPurchaseCost", t."amazonCommissionPrice",
  t."evaluationSaleNum", t."channelSaleNum",
  t."adSpCost", t."adSdCost", t."adSbCost", t."adSbvCost", t."adSbsCost",
  t."fbaStorageFeeAmount", t."fbaLongTermStorageFeeAmount", t."fbaRemovalFeeAmount", t."fbaDisposalFeeAmount",
  t."customAsinFee", t."customShopFee", t."serviceFeeAmount", t."storageFeeAmount", t."compensationAmount", t."evaluationFee",
  t."promotionTotalAmount", t."fbaOverageFeeAmount", t."chargebackAmount", t."guaranteeClaimAmount", t."digitalServicesFeeAmount", t."otherPriceAmount", t."shippingChargeAmount", t."regulatoryFeeAmount",
  t."couponPaymentAmount", t."sellerDealPaymentAmount", t."vineFeeAmount", t."starStorageFeeAmount", t."subscriptionAmount", t."fbaCustomerReturnAmount", t."fbaInboundConvenienceFeeAmount", t."inboundTransportationFeeAmount", t."shippingChargebackAmount", t."giftwrapChargebackAmount", t."costOfPointsGrantedAmount", t."orderOtherPriceAmount",
  t."fbaInboundTransportationProgramFee", t."aglFeeAmount", t."paidServicesFeeAmount", t."customerReturnHrrUnitFeeAmount", t."amazonUpstreamStorageTransportationFeeAmount", t."amazonUpstreamProcessingFeeAmount", t."mfnPostageFeeAmount", t."adjustmentFeeAmount", t."otherServiceFeeAmount", t."avgHeadTripPrice", t."purchaseRefundPrice", t."revenueAmount",
  t."fbaPerUnitFulfillmentFeeRefundAmount", t."fbaWeightBasedFeeRefundAmount", t."deferredAmount", t."withheldTaxAmount", t."otherPriceIncomeAmount", t."paymentMethodFeeAmount", t."fixedClosingFeeAmount", t."variableClosingFeeAmount", t."imagingServicesFeeAmount", t."netCoAmount", t."comminglingVatAmount", t."codFeeAmount",
  t."evaluationCapital", t."evaluationCommission", t."dealPerformanceFeeAmount", t."couponParticipationFeeAmount", t."safetReimbursedAmount", t."affordabilityExpenseAmount", t."withheldFeeAmount", t."chargebackIncomeAmount", t."guaranteeClaimIncomeAmount", t."promotionSalesAmount", t."promotionShippingAmount", t."promotionTaxAmount"
FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

COMMIT;
