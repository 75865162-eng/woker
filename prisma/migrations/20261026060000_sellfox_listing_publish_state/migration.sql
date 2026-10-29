-- Optional display-only DXM publish state; never infer pairing or price type.
-- Retain the existing trigger/transaction boundary and append to the current view.
BEGIN;
ALTER TABLE "SellfoxListingSnapshot" ADD COLUMN "dxmPublishState" TEXT;

CREATE OR REPLACE FUNCTION sellfox_listing_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bsr jsonb;
BEGIN
  NEW."dxmPublishState" := CASE WHEN jsonb_typeof(NEW.payload->'dxmPublishState')='string'
    THEN NULLIF(btrim(NEW.payload->>'dxmPublishState'),'') END;
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
  NEW."profitPrice" := sellfox_listing_number(NEW.payload->>'profitPrice');
  NEW."profitRate" := sellfox_listing_number(NEW.payload->>'profitRate');
  NEW."listingQuantity" := sellfox_listing_number(NEW.payload->>'quantity');
  NEW."unsellable" := sellfox_listing_number(NEW.payload->>'unsellable');
  NEW."warehousing" := sellfox_listing_number(NEW.payload->>'warehousing');
  RETURN NEW;
END;
$$;
-- Backfill all retained/partial snapshots without changing payload or Head.
-- This scans retained history: review row count/WAL and the DDL lock before apply.
UPDATE "SellfoxListingSnapshot" SET "dxmPublishState" =
  CASE WHEN jsonb_typeof(payload->'dxmPublishState')='string'
    THEN NULLIF(btrim(payload->>'dxmPublishState'),'') END;

CREATE OR REPLACE VIEW sellfox_listing_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."capturedAt", t."asin", t."msku", t."sku", t."parentAsin", t."title", t."status", t."price", t."currency", t."fulfillable", t."sales7", t."sales14", t."sales30", t."revenue7", t."revenue14", t."revenue30", t."adSpend7", t."adSpend14", t."adSpend30", t."sourceUpdatedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."fnsku", t."parentSku", t."mainImage", t."brand", t."amazonBrand", t."productTags", t."openDate", t."firstSaleDate", t."bsrCategory", t."buyBoxWinner", t."fulfillment", t."rating", t."ratingCount", t."bsrRank", t."purchaseCost", t."fbaFees", t."referralFee", t."totalFee", t."headTripCost", t."reservedQty", t."shippingPrice", t."profitPrice", t."profitRate", t."listingQuantity", t."unsellable", t."warehousing", t."productTagNames", t."ratingValue", t."dxmPublishState" FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" AND s."organizationId"=t."organizationId" AND s."workspaceId"=t."workspaceId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='listings' AND h."capturedAt"=t."capturedAt";

COMMIT;
