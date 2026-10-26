-- Append optional same-name profit custom/service/storage/compensation/evaluation fees. Local-only migration.
BEGIN;
ALTER TABLE "SellfoxProductDailySnapshot"
  ADD COLUMN "customAsinFee" DOUBLE PRECISION,
  ADD COLUMN "customShopFee" DOUBLE PRECISION,
  ADD COLUMN "serviceFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "storageFeeAmount" DOUBLE PRECISION,
  ADD COLUMN "compensationAmount" DOUBLE PRECISION,
  ADD COLUMN "evaluationFee" DOUBLE PRECISION;

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
  t."customAsinFee", t."customShopFee", t."serviceFeeAmount", t."storageFeeAmount", t."compensationAmount", t."evaluationFee"
FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

COMMIT;
