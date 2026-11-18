-- P1 3.2: Listing 画像窄表。列与 sellfox_listing_current 视图完全对齐（另加
-- headCapturedAt / syncedAt 供对账与版本校验），把热路径上的视图双层 join
-- (Snapshot JOIN Store JOIN SnapshotHead) 物化成单表扫描。
-- 读路径默认仍走视图；仅当 SELLFOX_LISTING_PROFILE_READ_ENABLED=true 才切到本表，
-- 且必须先通过对账脚本（0 差异）。这里只建表 + 回填 + 索引，不改任何视图定义。
CREATE TABLE "SellfoxListingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "asin" TEXT NOT NULL,
    "msku" TEXT,
    "sku" TEXT NOT NULL,
    "parentAsin" TEXT,
    "title" TEXT,
    "status" TEXT,
    "price" DECIMAL(20,4),
    "currency" TEXT,
    "fulfillable" INTEGER,
    "sales7" INTEGER,
    "sales14" INTEGER,
    "sales30" INTEGER,
    "revenue7" DECIMAL(20,4),
    "revenue14" DECIMAL(20,4),
    "revenue30" DECIMAL(20,4),
    "adSpend7" DECIMAL(20,4),
    "adSpend14" DECIMAL(20,4),
    "adSpend30" DECIMAL(20,4),
    "sourceUpdatedAt" TEXT,
    "shopExternalId" TEXT,
    "name" TEXT,
    "marketplace" TEXT,
    "fnsku" TEXT,
    "parentSku" TEXT,
    "mainImage" TEXT,
    "brand" TEXT,
    "amazonBrand" TEXT,
    "productTags" TEXT,
    "openDate" TEXT,
    "firstSaleDate" TEXT,
    "bsrCategory" TEXT,
    "buyBoxWinner" TEXT,
    "fulfillment" TEXT,
    "rating" TEXT,
    "ratingCount" DOUBLE PRECISION,
    "bsrRank" DOUBLE PRECISION,
    "purchaseCost" DECIMAL(20,4),
    "fbaFees" DECIMAL(20,4),
    "referralFee" DECIMAL(20,4),
    "totalFee" DECIMAL(20,4),
    "headTripCost" DOUBLE PRECISION,
    "reservedQty" DOUBLE PRECISION,
    "shippingPrice" DECIMAL(20,4),
    "profitPrice" DECIMAL(20,4),
    "profitRate" DOUBLE PRECISION,
    "listingQuantity" DOUBLE PRECISION,
    "unsellable" DOUBLE PRECISION,
    "warehousing" DOUBLE PRECISION,
    "productTagNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ratingValue" DOUBLE PRECISION,
    "dxmPublishState" TEXT,
    "developer" TEXT,
    "spu" TEXT,
    "headCapturedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    CONSTRAINT "sellfox_listing_profile_pkey" PRIMARY KEY ("id")
);

-- One-shot backfill straight from the view: guarantees the materialized rows are
-- byte-for-byte the口径 the view would return at migration time. Empty DB -> no rows,
-- no fabricated defaults. headCapturedAt/syncedAt are the view's capturedAt.
INSERT INTO "SellfoxListingProfile" (
  "id","organizationId","workspaceId","storeId","sourceKey","capturedAt","asin","msku","sku",
  "parentAsin","title","status","price","currency","fulfillable","sales7","sales14","sales30",
  "revenue7","revenue14","revenue30","adSpend7","adSpend14","adSpend30","sourceUpdatedAt",
  "shopExternalId","name","marketplace","fnsku","parentSku","mainImage","brand","amazonBrand",
  "productTags","openDate","firstSaleDate","bsrCategory","buyBoxWinner","fulfillment","rating",
  "ratingCount","bsrRank","purchaseCost","fbaFees","referralFee","totalFee","headTripCost",
  "reservedQty","shippingPrice","profitPrice","profitRate","listingQuantity","unsellable",
  "warehousing","productTagNames","ratingValue","dxmPublishState","developer","spu",
  "headCapturedAt","syncedAt"
)
SELECT v."id",v."organizationId",v."workspaceId",v."storeId",v."sourceKey",v."capturedAt",v."asin",v."msku",v."sku",
  v."parentAsin",v."title",v."status",v."price",v."currency",v."fulfillable",v."sales7",v."sales14",v."sales30",
  v."revenue7",v."revenue14",v."revenue30",v."adSpend7",v."adSpend14",v."adSpend30",v."sourceUpdatedAt",
  v."shopExternalId",v."name",v."marketplace",v."fnsku",v."parentSku",v."mainImage",v."brand",v."amazonBrand",
  v."productTags",v."openDate",v."firstSaleDate",v."bsrCategory",v."buyBoxWinner",v."fulfillment",v."rating",
  v."ratingCount",v."bsrRank",v."purchaseCost",v."fbaFees",v."referralFee",v."totalFee",v."headTripCost",
  v."reservedQty",v."shippingPrice",v."profitPrice",v."profitRate",v."listingQuantity",v."unsellable",
  v."warehousing",v."productTagNames",v."ratingValue",v."dxmPublishState",v."developer",v."spu",
  v."capturedAt",v."capturedAt"
FROM sellfox_listing_current v
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "sellfox_listing_profile_identity"
  ON "SellfoxListingProfile" ("organizationId","workspaceId","storeId","sourceKey");
CREATE INDEX "sellfox_listing_profile_lookup"
  ON "SellfoxListingProfile" ("organizationId","workspaceId","storeId","msku","capturedAt");
CREATE INDEX "sellfox_listing_profile_brand"
  ON "SellfoxListingProfile" ("organizationId","workspaceId","brand","storeId","capturedAt");
CREATE INDEX "sellfox_listing_profile_tags"
  ON "SellfoxListingProfile" USING GIN ("productTagNames");
