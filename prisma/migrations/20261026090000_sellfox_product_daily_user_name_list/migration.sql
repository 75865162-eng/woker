-- Project profit salesperson names on the existing fact table; preserve all five fee projections.
BEGIN;
ALTER TABLE "SellfoxProductDailySnapshot"
  ADD COLUMN "userNameList" TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION sellfox_product_daily_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."refundPrice" := sellfox_listing_number(NEW.payload->>'refundPrice');
  NEW."refundNum" := sellfox_listing_number(NEW.payload->>'refundNum');
  NEW."commodityCost" := sellfox_listing_number(NEW.payload->>'commodityCost');
  NEW."shippingPrice" := sellfox_listing_number(NEW.payload->>'shippingPrice');
  NEW."taxPrice" := sellfox_listing_number(NEW.payload->>'taxPrice');
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
  t."userNameList"
FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE INDEX sellfox_product_daily_user_name_list
  ON "SellfoxProductDailySnapshot" USING GIN ("userNameList");

COMMIT;
