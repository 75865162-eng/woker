BEGIN;

CREATE TEMP TABLE "LegacyProductRecordIds" ON COMMIT DROP AS
SELECT
  "id",
  "organizationId",
  "workspaceId",
  "sku"
FROM "ProductRecord"
WHERE "source" = 'sellfox'
   OR "id" ILIKE 'sellfox-%'
   OR COALESCE("payload"->>'note', '') ILIKE '%赛狐在线产品 API%';

UPDATE "ProductAttachmentBinding" AS binding
SET
  "status" = 'orphan',
  "linkedAt" = NULL
FROM "LegacyProductRecordIds" AS legacy
WHERE binding."organizationId" = legacy."organizationId"
  AND binding."workspaceId" = legacy."workspaceId"
  AND binding."productSku" = legacy."sku";

DELETE FROM "ProductRecord" AS product
USING "LegacyProductRecordIds" AS legacy
WHERE product."id" = legacy."id";

DELETE FROM "ProductListSummaryRecord"
WHERE "source" = 'sellfox';

DROP TABLE IF EXISTS "ProductImageCopyGalleryRecord";
DROP TABLE IF EXISTS "SellfoxProductRecord";

COMMIT;
