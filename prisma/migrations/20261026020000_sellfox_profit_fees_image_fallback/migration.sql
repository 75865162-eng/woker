ALTER TABLE "SellfoxProductDailySnapshot"
  ADD COLUMN "promotionDiscount" DOUBLE PRECISION,
  ADD COLUMN "giftWrapFee" DOUBLE PRECISION,
  ADD COLUMN "imageUrl" TEXT;

UPDATE "SellfoxProductDailySnapshot"
SET "promotionDiscount" = CASE
      WHEN payload->>'promotionDiscountAmount' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$'
        THEN (payload->>'promotionDiscountAmount')::double precision
    END,
    "giftWrapFee" = CASE
      WHEN payload->>'giftWrapAmount' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$'
        THEN (payload->>'giftWrapAmount')::double precision
    END,
    "imageUrl" = NULLIF(btrim(payload->>'imageUrl'), '');

CREATE OR REPLACE VIEW sellfox_profit_daily AS SELECT
  t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."title", t."currency", t."saleQuantity", t."saleRevenue", t."grossProfit", t."grossProfitRate", t."adCost", t."refundRate", t."orderNum", t."netRevenue", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."onlySettle",
  t."promotionDiscount", t."giftWrapFee", t."imageUrl"
FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";
