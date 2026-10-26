BEGIN;

-- Provisional XLSX contracts; placement is campaign/placement/day, adGroupId is metadata only.
-- CreateTable
CREATE TABLE "SellfoxAdsCampaignDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT,
    "asin" TEXT,
    "msku" TEXT,
    "currency" TEXT,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "cost" DOUBLE PRECISION,
    "adOrders" INTEGER,
    "adSales" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellfoxAdsCampaignDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxAdsAdGroupDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "adGroupName" TEXT,
    "targetingText" TEXT,
    "matchType" TEXT,
    "asin" TEXT,
    "msku" TEXT,
    "currency" TEXT,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "cost" DOUBLE PRECISION,
    "adOrders" INTEGER,
    "adSales" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellfoxAdsAdGroupDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxAdsPlacementDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "adGroupId" TEXT,
    "asin" TEXT,
    "msku" TEXT,
    "currency" TEXT,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "cost" DOUBLE PRECISION,
    "adOrders" INTEGER,
    "adSales" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellfoxAdsPlacementDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellfoxAdsCampaignDaily_organizationId_workspaceId_storeId__idx" ON "SellfoxAdsCampaignDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsCampaignDaily_organizationId_workspaceId_asin_rep_idx" ON "SellfoxAdsCampaignDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_campaign_daily_identity" ON "SellfoxAdsCampaignDaily"("storeId", "reportDate", "adType", "campaignId");

-- CreateIndex
CREATE INDEX "SellfoxAdsAdGroupDaily_organizationId_workspaceId_storeId_r_idx" ON "SellfoxAdsAdGroupDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsAdGroupDaily_organizationId_workspaceId_asin_repo_idx" ON "SellfoxAdsAdGroupDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_ad_group_daily_identity" ON "SellfoxAdsAdGroupDaily"("storeId", "reportDate", "adType", "campaignId", "adGroupId");

-- CreateIndex
CREATE INDEX "SellfoxAdsPlacementDaily_organizationId_workspaceId_storeId_idx" ON "SellfoxAdsPlacementDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsPlacementDaily_organizationId_workspaceId_asin_re_idx" ON "SellfoxAdsPlacementDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_placement_daily_identity" ON "SellfoxAdsPlacementDaily"("storeId", "reportDate", "adType", "campaignId", "placement");

-- AddForeignKey
ALTER TABLE "SellfoxAdsCampaignDaily" ADD CONSTRAINT "SellfoxAdsCampaignDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxAdsAdGroupDaily" ADD CONSTRAINT "SellfoxAdsAdGroupDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxAdsPlacementDaily" ADD CONSTRAINT "SellfoxAdsPlacementDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE VIEW sellfox_ads_campaign_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."campaignName", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsCampaignDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_ads_ad_group_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."adGroupId", t."adGroupName", t."targetingText", t."matchType", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsAdGroupDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_ads_placement_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."placement", t."adGroupId", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsPlacementDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

COMMIT;
