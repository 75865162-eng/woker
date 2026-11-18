-- P1 3.3: materialize `complete` from the per-row coverage EXISTS subquery into a
-- physical column on SellfoxSalesDailySnapshot, so sellfox_sales_daily no longer
-- runs a correlated subquery for every fact row.
--
-- Data discipline:
--  * Missing data stays NULL on the physical column (never padded to false/zero).
--  * The view exposes COALESCE(complete, false) so the existing read口径 is byte-for-byte
--    identical to the previous EXISTS(...) boolean. No business rule changes.
ALTER TABLE "SellfoxSalesDailySnapshot" ADD COLUMN "complete" BOOLEAN;

-- One-shot backfill: only rows that actually have a matching, done coverage row are
-- marked complete; everything else keeps NULL (unknown) rather than being padded.
UPDATE "SellfoxSalesDailySnapshot" t
SET "complete" = TRUE
WHERE EXISTS (
  SELECT 1 FROM "SellfoxSalesDayCoverage" c
  WHERE c."storeId" = t."storeId"
    AND c."reportDate" = t."reportDate"
    AND c."capturedAt" = t."syncedAt"
);

-- Rebuild the view without the correlated EXISTS. Column names, order and types are
-- unchanged; only the `complete` expression is swapped to the materialized column.
CREATE OR REPLACE VIEW "sellfox_sales_daily" AS SELECT t.id,
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
    COALESCE(t."complete", FALSE) AS complete,
    t.orders
   FROM ("SellfoxSalesDailySnapshot" t
     JOIN "SellfoxStore" s ON ((s.id = t."storeId")));
