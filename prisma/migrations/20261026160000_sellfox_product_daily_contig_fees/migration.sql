-- Append contiguous same-name profit fees. Local-only migration; preserves all 150000 projections.
BEGIN;
ALTER TABLE "SellfoxProductDailySnapshot"
  ADD COLUMN "couponPaymentAmount" DOUBLE PRECISION,
  ADD COLUMN "sellerDealPaymentAmount" DOUBLE PRECISION,
  ADD COLUMN "vineFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "starStorageFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "subscriptionAmount" DOUBLE PRECISION,
  ADD COLUMN "fbaCustomerReturnAmount" DOUBLE PRECISION,
  ADD COLUMN "fbaInboundConvenienceFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "inboundTransportationFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "shippingChargebackAmount" DOUBLE PRECISION,
  ADD COLUMN "giftwrapChargebackAmount" DOUBLE PRECISION,
  ADD COLUMN "costOfPointsGrantedAmount" DOUBLE PRECISION,
  ADD COLUMN "orderOtherPriceAmount" DOUBLE PRECISION;

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

-- Backfill all retained facts without changing payload contents or requesting Sellfox.
-- Review historical row count, WAL/disk and DDL/row-lock duration before real apply.
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
  t."couponPaymentAmount", t."sellerDealPaymentAmount", t."vineFeeAmount", t."starStorageFeeAmount", t."subscriptionAmount", t."fbaCustomerReturnAmount", t."fbaInboundConvenienceFeeAmount", t."inboundTransportationFeeAmount", t."shippingChargebackAmount", t."giftwrapChargebackAmount", t."costOfPointsGrantedAmount", t."orderOtherPriceAmount"
FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

COMMIT;
