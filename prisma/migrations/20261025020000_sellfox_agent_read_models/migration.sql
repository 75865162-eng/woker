-- AlterTable
ALTER TABLE "SellfoxProductDailySnapshot" ADD COLUMN     "netRevenue" DOUBLE PRECISION,
ADD COLUMN     "orderNum" INTEGER,
ALTER COLUMN "saleQuantity" DROP NOT NULL,
ALTER COLUMN "saleQuantity" DROP DEFAULT,
ALTER COLUMN "fbaQuantity" DROP NOT NULL,
ALTER COLUMN "fbaQuantity" DROP DEFAULT,
ALTER COLUMN "fbmQuantity" DROP NOT NULL,
ALTER COLUMN "fbmQuantity" DROP DEFAULT,
ALTER COLUMN "saleRevenue" DROP NOT NULL,
ALTER COLUMN "saleRevenue" DROP DEFAULT,
ALTER COLUMN "grossProfit" DROP NOT NULL,
ALTER COLUMN "grossProfit" DROP DEFAULT,
ALTER COLUMN "grossProfitRate" DROP NOT NULL,
ALTER COLUMN "grossProfitRate" DROP DEFAULT,
ALTER COLUMN "adCost" DROP NOT NULL,
ALTER COLUMN "adCost" DROP DEFAULT,
ALTER COLUMN "refundRate" DROP NOT NULL,
ALTER COLUMN "refundRate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SellfoxFbaInventorySnapshot" ADD COLUMN     "avgInventoryCost" DOUBLE PRECISION,
ADD COLUMN     "avgTransportCost" DOUBLE PRECISION,
ADD COLUMN     "commodityName" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "inTransit" INTEGER,
ADD COLUMN     "inboundReceiving" INTEGER,
ADD COLUMN     "inboundShipped" INTEGER,
ADD COLUMN     "inboundWorking" INTEGER,
ADD COLUMN     "reservedCustomerorders" INTEGER,
ADD COLUMN     "reservedProcessing" INTEGER,
ADD COLUMN     "reservedTransfer" INTEGER,
ADD COLUMN     "totalInventory" INTEGER,
ADD COLUMN     "unfulfillable" INTEGER,
ADD COLUMN     "warehouseName" TEXT;

-- AlterTable
ALTER TABLE "SellfoxSyncSchedule" ADD COLUMN     "backfillNextDate" TEXT,
ADD COLUMN     "backfillStart" TEXT;

-- CreateTable
CREATE TABLE "SellfoxSnapshotHead" (
    "storeId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxSnapshotHead_pkey" PRIMARY KEY ("storeId","resource")
);

-- CreateTable
CREATE TABLE "SellfoxListingSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "asin" TEXT NOT NULL,
    "msku" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "parentAsin" TEXT,
    "title" TEXT,
    "status" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "fulfillable" INTEGER,
    "sales7" INTEGER,
    "sales14" INTEGER,
    "sales30" INTEGER,
    "revenue7" DOUBLE PRECISION,
    "revenue14" DOUBLE PRECISION,
    "revenue30" DOUBLE PRECISION,
    "adSpend7" DOUBLE PRECISION,
    "adSpend14" DOUBLE PRECISION,
    "adSpend30" DOUBLE PRECISION,
    "sourceUpdatedAt" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "SellfoxListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxReportTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "status" TEXT NOT NULL,
    "fileKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxReportTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxAdsProductDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "adType" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
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

    CONSTRAINT "SellfoxAdsProductDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellfoxSalesDayCoverage" (
    "storeId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "rowWrites" INTEGER NOT NULL,

    CONSTRAINT "SellfoxSalesDayCoverage_pkey" PRIMARY KEY ("storeId","reportDate")
);

-- CreateIndex
CREATE INDEX "SellfoxListingSnapshot_organizationId_workspaceId_storeId_m_idx" ON "SellfoxListingSnapshot"("organizationId", "workspaceId", "storeId", "msku", "capturedAt");

-- CreateIndex
CREATE INDEX "SellfoxListingSnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxListingSnapshot"("organizationId", "workspaceId", "asin");

-- CreateIndex
CREATE UNIQUE INDEX "SellfoxListingSnapshot_storeId_capturedAt_sourceKey_key" ON "SellfoxListingSnapshot"("storeId", "capturedAt", "sourceKey");

-- CreateIndex
CREATE INDEX "SellfoxReportTask_organizationId_workspaceId_status_idx" ON "SellfoxReportTask"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SellfoxReportTask_runId_storeId_adType_key" ON "SellfoxReportTask"("runId", "storeId", "adType");

-- CreateIndex
CREATE INDEX "SellfoxAdsProductDaily_organizationId_workspaceId_storeId_r_idx" ON "SellfoxAdsProductDaily"("organizationId", "workspaceId", "storeId", "reportDate");

-- CreateIndex
CREATE INDEX "SellfoxAdsProductDaily_organizationId_workspaceId_asin_repo_idx" ON "SellfoxAdsProductDaily"("organizationId", "workspaceId", "asin", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "sellfox_ads_product_daily_identity" ON "SellfoxAdsProductDaily"("storeId", "reportDate", "adType", "campaignId", "adGroupId", "productId");

-- CreateIndex
CREATE INDEX "sellfox_inventory_current_lookup" ON "SellfoxFbaInventorySnapshot"("storeId", "capturedAt", "msku");

-- CreateIndex
CREATE INDEX "sellfox_sales_agent_lookup" ON "SellfoxSalesDailySnapshot"("organizationId", "workspaceId", "storeId", "msku", "reportDate");

-- AddForeignKey
ALTER TABLE "SellfoxSnapshotHead" ADD CONSTRAINT "SellfoxSnapshotHead_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxListingSnapshot" ADD CONSTRAINT "SellfoxListingSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxReportTask" ADD CONSTRAINT "SellfoxReportTask_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxAdsProductDaily" ADD CONSTRAINT "SellfoxAdsProductDaily_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellfoxSalesDayCoverage" ADD CONSTRAINT "SellfoxSalesDayCoverage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "SellfoxFbaInventorySnapshot" SET "totalInventory" = CASE WHEN payload->>'totalInventory' ~ '^-?[0-9]{1,9}$' THEN (payload->>'totalInventory')::integer END,
"inTransit" = CASE WHEN payload->>'inTransit' ~ '^-?[0-9]{1,9}$' THEN (payload->>'inTransit')::integer END,
"inboundWorking" = CASE WHEN payload->>'inboundWorking' ~ '^-?[0-9]{1,9}$' THEN (payload->>'inboundWorking')::integer END,
"inboundShipped" = CASE WHEN payload->>'inboundShipped' ~ '^-?[0-9]{1,9}$' THEN (payload->>'inboundShipped')::integer END,
"inboundReceiving" = CASE WHEN payload->>'inboundReceiving' ~ '^-?[0-9]{1,9}$' THEN (payload->>'inboundReceiving')::integer END,
"reservedTransfer" = CASE WHEN payload->>'reservedTransfer' ~ '^-?[0-9]{1,9}$' THEN (payload->>'reservedTransfer')::integer END,
"reservedProcessing" = CASE WHEN payload->>'reservedProcessing' ~ '^-?[0-9]{1,9}$' THEN (payload->>'reservedProcessing')::integer END,
"reservedCustomerorders" = CASE WHEN payload->>'reservedCustomerorders' ~ '^-?[0-9]{1,9}$' THEN (payload->>'reservedCustomerorders')::integer END,
"unfulfillable" = CASE WHEN payload->>'unfulfillable' ~ '^-?[0-9]{1,9}$' THEN (payload->>'unfulfillable')::integer END,
"avgInventoryCost" = CASE WHEN payload->>'avgInventoryCost' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'avgInventoryCost')::double precision END,
"avgTransportCost" = CASE WHEN payload->>'avgTransportCost' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'avgTransportCost')::double precision END,
"warehouseName" = NULLIF(payload->>'warehouseName', ''),
"commodityName" = NULLIF(payload->>'commodityName', ''),
"currency" = NULLIF(payload->>'currency', '');

INSERT INTO "SellfoxSnapshotHead" ("storeId", "resource", "capturedAt")
SELECT DISTINCT ON (i."storeId") i."storeId", 'inventory', i."capturedAt"
FROM "SellfoxFbaInventorySnapshot" i
JOIN "SellfoxSyncRun" r ON r."organizationId"=i."organizationId" AND r."workspaceId"=i."workspaceId"
 AND r.resource='inventory' AND r.status='done' AND r.summary->>'capturedAt'=to_char(i."capturedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
ORDER BY i."storeId", i."capturedAt" DESC ON CONFLICT DO NOTHING;

CREATE VIEW sellfox_inventory_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."capturedAt", t."asin", t."msku", t."sku", t."fnsku", t."quantity", t."totalInventory", t."inTransit", t."inboundWorking", t."inboundShipped", t."inboundReceiving", t."reservedTransfer", t."reservedProcessing", t."reservedCustomerorders", t."unfulfillable", t."warehouseName", t."commodityName", t."currency", t."avgInventoryCost", t."avgTransportCost", s."externalId" AS "shopExternalId", s.name, s.marketplace FROM "SellfoxFbaInventorySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='inventory' AND h."capturedAt"=t."capturedAt";

CREATE VIEW sellfox_listing_current AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."capturedAt", t."asin", t."msku", t."sku", t."parentAsin", t."title", t."status", t."price", t."currency", t."fulfillable", t."sales7", t."sales14", t."sales30", t."revenue7", t."revenue14", t."revenue30", t."adSpend7", t."adSpend14", t."adSpend30", t."sourceUpdatedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId" JOIN "SellfoxSnapshotHead" h ON h."storeId"=t."storeId" AND h.resource='listings' AND h."capturedAt"=t."capturedAt";

CREATE VIEW sellfox_sales_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."quantity", t."revenue", t."currency", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, EXISTS (SELECT 1 FROM "SellfoxSalesDayCoverage" c WHERE c."storeId"=t."storeId" AND c."reportDate"=t."reportDate" AND c."capturedAt"=t."syncedAt") AS complete FROM "SellfoxSalesDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_profit_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."sourceKey", t."reportDate", t."asin", t."msku", t."sku", t."title", t."currency", t."saleQuantity", t."saleRevenue", t."grossProfit", t."grossProfitRate", t."adCost", t."refundRate", t."orderNum", t."netRevenue", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace FROM "SellfoxProductDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_ads_product_daily AS SELECT t."id", t."organizationId", t."workspaceId", t."storeId", t."reportDate", t."adType", t."campaignId", t."adGroupId", t."productId", t."asin", t."msku", t."currency", t."impressions", t."clicks", t."cost", t."adOrders", t."adSales", t."syncedAt", s."externalId" AS "shopExternalId", s.name, s.marketplace, CASE WHEN t."adSales">0 THEN t.cost / t."adSales" END AS acos, CASE WHEN t.cost>0 THEN t."adSales" / t.cost END AS roas FROM "SellfoxAdsProductDaily" t JOIN "SellfoxStore" s ON s.id=t."storeId";

CREATE VIEW sellfox_sales_day_coverage AS SELECT s."organizationId", s."workspaceId", s."externalId" AS "shopExternalId", c.* FROM "SellfoxSalesDayCoverage" c JOIN "SellfoxStore" s ON s.id=c."storeId";

UPDATE "SellfoxProductDailySnapshot" SET "saleQuantity" = CASE WHEN payload->>'saleNum' ~ '^-?[0-9]{1,9}$' THEN (payload->>'saleNum')::integer END, "fbaQuantity" = CASE WHEN payload->>'saleNumFba' ~ '^-?[0-9]{1,9}$' THEN (payload->>'saleNumFba')::integer END, "fbmQuantity" = CASE WHEN payload->>'saleNumFbm' ~ '^-?[0-9]{1,9}$' THEN (payload->>'saleNumFbm')::integer END, "saleRevenue" = CASE WHEN payload->>'salePrice' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'salePrice')::double precision END, "grossProfit" = CASE WHEN payload->>'profit' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'profit')::double precision END, "grossProfitRate" = CASE WHEN payload->>'profitRate' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'profitRate')::double precision END, "adCost" = CASE WHEN payload->>'adTotalCost' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'adTotalCost')::double precision END, "refundRate" = CASE WHEN payload->>'refundPercent' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'refundPercent')::double precision END, "orderNum" = CASE WHEN payload->>'orderNum' ~ '^-?[0-9]{1,9}$' THEN (payload->>'orderNum')::integer END, "netRevenue" = CASE WHEN payload->>'salesPriceNet' ~ '^-?[0-9]{1,12}([.][0-9]{1,8})?$' THEN (payload->>'salesPriceNet')::double precision END;
UPDATE "SellfoxProductDailySnapshot" SET "asin" = COALESCE((SELECT string_agg(CASE WHEN jsonb_typeof(v)='object' THEN v->>'asin' ELSE v#>>'{}' END, ',' ORDER BY n) FROM jsonb_array_elements(payload->'asinList') WITH ORDINALITY a(v,n)), '') WHERE jsonb_typeof(payload->'asinList')='array';
UPDATE "SellfoxProductDailySnapshot" SET "sku" = COALESCE((SELECT string_agg(CASE WHEN jsonb_typeof(v)='object' THEN v->>'sku' ELSE v#>>'{}' END, ',' ORDER BY n) FROM jsonb_array_elements(payload->'skuList') WITH ORDINALITY a(v,n)), '') WHERE jsonb_typeof(payload->'skuList')='array';
