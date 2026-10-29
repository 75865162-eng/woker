BEGIN;

-- AlterTable
ALTER TABLE "SellfoxReportTask" ADD COLUMN     "reportTypeCode" TEXT NOT NULL DEFAULT 'adProductReport';

-- DropIndex
DROP INDEX "SellfoxReportTask_runId_storeId_adType_key";

-- CreateTable
CREATE TABLE "SellfoxAdsTargetingDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "targetingId" TEXT NOT NULL,
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

    CONSTRAINT "SellfoxAdsTargetingDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxAdsSearchTermDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "targetingId" TEXT NOT NULL DEFAULT '',
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

    CONSTRAINT "SellfoxAdsSearchTermDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellfoxAdsTargetingDaily_organizationId_workspaceId_storeId_idx" ON "SellfoxAdsTargetingDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsTargetingDaily_organizationId_workspaceId_asin_re_idx" ON "SellfoxAdsTargetingDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_targeting_daily_identity" ON "SellfoxAdsTargetingDaily"("storeId", "reportDate", "adType", "campaignId", "adGroupId", "targetingId");

-- CreateIndex
CREATE INDEX "SellfoxAdsSearchTermDaily_organizationId_workspaceId_storeI_idx" ON "SellfoxAdsSearchTermDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsSearchTermDaily_organizationId_workspaceId_asin_r_idx" ON "SellfoxAdsSearchTermDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_search_term_daily_identity" ON "SellfoxAdsSearchTermDaily"("storeId", "reportDate", "adType", "campaignId", "adGroupId", "searchTerm", "targetingId");

-- CreateIndex
CREATE UNIQUE INDEX "SellfoxReportTask_runId_storeId_adType_reportTypeCode_key" ON "SellfoxReportTask"("runId", "storeId", "adType", "reportTypeCode");

-- AddForeignKey
ALTER TABLE "SellfoxAdsTargetingDaily" ADD CONSTRAINT "SellfoxAdsTargetingDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxAdsSearchTermDaily" ADD CONSTRAINT "SellfoxAdsSearchTermDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE VIEW sellfox_ads_targeting_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."adGroupId", t."targetingId", t."targetingText", t."matchType", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsTargetingDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_ads_search_term_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."adGroupId", t."searchTerm", t."targetingId", t."targetingText", t."matchType", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsSearchTermDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

COMMIT;
