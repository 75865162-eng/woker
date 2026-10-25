-- Verified V2 deleted Listing can retain id + ASIN while sku is empty.
-- Keep the upstream absence as NULL; no ProductRecord or other snapshot changes.
ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN "msku" DROP NOT NULL;
