-- Additive only: existing snapshots remain NULL until a normal complete Listing refresh.
ALTER TABLE "SellfoxListingSnapshot"
  ADD COLUMN "fnsku" TEXT,
  ADD COLUMN "parentSku" TEXT,
  ADD COLUMN "mainImage" TEXT;

-- Append columns to preserve the existing view column order and dependent readers.
CREATE OR REPLACE VIEW sellfox_listing_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."capturedAt", t."asin", t."msku", t."sku", t."parentAsin", t."title", t."status", t."price", t."currency", t."fulfillable", t."sales7", t."sales14", t."sales30", t."revenue7", t."revenue14", t."revenue30", t."adSpend7", t."adSpend14", t."adSpend30", t."sourceUpdatedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, t."fnsku", t."parentSku", t."mainImage" FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='listings' AND h."capturedAt"=t."capturedAt";
