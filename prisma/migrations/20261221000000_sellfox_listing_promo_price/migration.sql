-- 优惠价列：官方 API 定义 listingPricing=「优惠价」，2026-11-19 生产真实数据核验
-- （SellfoxListingSnapshot 195930 行，listingPricing 有效值 17935 行）确认字段存在。
-- 划线价/List Price/B2B 价在真实 payload 与官方 API 均无对应键 → 不建列、UI 显示 —，不猜字段。
-- 纯加列 + 投影，无回填兜底：无 listingPricing 的历史行 promoPrice=NULL，禁止补 0 或复制 price。
ALTER TABLE "SellfoxListingSnapshot" ADD COLUMN IF NOT EXISTS "promoPrice" DECIMAL(20,4);
ALTER TABLE "SellfoxListingProfile" ADD COLUMN IF NOT EXISTS "promoPrice" DECIMAL(20,4);

-- 重建投影函数：从 payload.listingPricing 提取优惠价（复用既有安全数值解析，脏值→NULL）。
CREATE OR REPLACE FUNCTION sellfox_listing_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bsr jsonb;
BEGIN
  NEW."brand" := NULLIF(btrim(NEW.payload->>'brand'),'');
  NEW."amazonBrand" := NULLIF(btrim(NEW.payload->>'amazonBrand'),'');
  NEW."openDate" := NULLIF(NEW.payload->>'openDate','');
  NEW."firstSaleDate" := COALESCE(NULLIF(NEW.payload->>'firstSaleDate',''),NULLIF(NEW.payload->>'firstOrderDate',''));
  NEW.fulfillment := CASE WHEN NEW.payload->>'switchFulfillmentTo' IN ('AFN','MFN') THEN NEW.payload->>'switchFulfillmentTo' END;
  NEW."buyBoxWinner" := CASE WHEN NEW.payload->'buyBoxWinner'='true'::jsonb THEN '是' WHEN NEW.payload->'buyBoxWinner'='false'::jsonb THEN '否' END;
  NEW."productTagNames" := ARRAY(SELECT DISTINCT btrim(label.value->>'labelName')
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.payload->'productLabelList')='array' THEN NEW.payload->'productLabelList' ELSE '[]'::jsonb END) label_group(value)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(label_group.value->'labelDetailList')='array' THEN label_group.value->'labelDetailList' ELSE '[]'::jsonb END) label(value)
    WHERE NULLIF(btrim(label.value->>'labelName'),'') IS NOT NULL ORDER BY 1);
  NEW."productTags" := array_to_string(NEW."productTagNames",'、',NULL);
  IF cardinality(NEW."productTagNames")=0 THEN NEW."productTags" := NULL; END IF;
  SELECT elem.value INTO bsr
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.payload->'bsrRank')='array' THEN NEW.payload->'bsrRank' ELSE '[]'::jsonb END) WITH ORDINALITY elem(value,ordinality)
    WHERE NULLIF(elem.value->>'rank','') ~ '^[0-9]+([.][0-9]+)?$'
    ORDER BY CASE WHEN elem.value->>'bigCategory' IN ('true','TRUE','1') THEN 0 ELSE 1 END,elem.ordinality LIMIT 1;
  NEW."bsrRank" := NULLIF(sellfox_listing_number(bsr->>'rank'),9999999);
  NEW."bsrCategory" := NULLIF(btrim(bsr->>'categoryName'),'');
  NEW."rating" := NULLIF(NEW.payload->>'rating','');
  NEW."ratingValue" := sellfox_listing_number(NEW.payload->>'rating');
  NEW."ratingCount" := sellfox_listing_number(NEW.payload->>'ratingCount');
  NEW."purchaseCost" := sellfox_listing_number(NEW.payload->>'purchaseCost');
  NEW."fbaFees" := sellfox_listing_number(NEW.payload->>'fbaFees');
  NEW."referralFee" := sellfox_listing_number(NEW.payload->>'referralFee');
  NEW."totalFee" := sellfox_listing_number(NEW.payload->>'totalFee');
  NEW."headTripCost" := sellfox_listing_number(NEW.payload->>'headTripCost');
  NEW."reservedQty" := sellfox_listing_number(NEW.payload->>'reservedQty');
  NEW."shippingPrice" := sellfox_listing_number(COALESCE(NULLIF(NEW.payload->>'shippingPrice',''),NULLIF(NEW.payload->>'shipCost','')));
  NEW."promoPrice" := sellfox_listing_number(NULLIF(NEW.payload->>'listingPricing',''));
  NEW."profitPrice" := sellfox_listing_number(NEW.payload->>'profitPrice');
  NEW."profitRate" := sellfox_listing_number(NEW.payload->>'profitRate');
  NEW."listingQuantity" := sellfox_listing_number(NEW.payload->>'quantity');
  NEW."unsellable" := sellfox_listing_number(NEW.payload->>'unsellable');
  NEW."warehousing" := sellfox_listing_number(NEW.payload->>'warehousing');
  RETURN NEW;
END;
$$;

-- 视图在最新定义基础上透出 promoPrice（显式列清单，必须重建）。
CREATE OR REPLACE VIEW sellfox_listing_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."capturedAt", t."asin", t."msku", t."sku", t."parentAsin", t."title", t."status", t."price", t."currency", t."fulfillable", t."sales7", t."sales14", t."sales30", t."revenue7", t."revenue14", t."revenue30", t."adSpend7", t."adSpend14", t."adSpend30", t."sourceUpdatedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."fnsku", t."parentSku", t."mainImage", t."brand", t."amazonBrand", t."productTags", t."openDate", t."firstSaleDate", t."bsrCategory", t."buyBoxWinner", t."fulfillment", t."rating", t."ratingCount", t."bsrRank", t."purchaseCost", t."fbaFees", t."referralFee", t."totalFee", t."headTripCost", t."reservedQty", t."shippingPrice", t."profitPrice", t."profitRate", t."listingQuantity", t."unsellable", t."warehousing", t."productTagNames", t."ratingValue", t."dxmPublishState", t."developer", t."spu", t."promoPrice" FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" AND s."organizationId"=t."organizationId" AND s."workspaceId"=t."workspaceId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='listings' AND h."capturedAt"=t."capturedAt";

-- 回填既有快照：payload=payload 触发 BEFORE UPDATE OF payload，重算投影（真实数据，
-- 无 listingPricing 的行得到 NULL 而非 0）。维护窗口执行，注意 WAL。
UPDATE "SellfoxListingSnapshot" SET payload=payload;

-- Profile 镜像表从新视图重填 promoPrice（只读回填，口径与视图一致）。
UPDATE "SellfoxListingProfile" p SET "promoPrice" = v."promoPrice"
FROM sellfox_listing_current v WHERE p."id"=v."id" AND p."promoPrice" IS DISTINCT FROM v."promoPrice";

