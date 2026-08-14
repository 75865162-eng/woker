CREATE TABLE "SellfoxProductDailySnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "storeId" TEXT NOT NULL,
  "reportDate" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "msku" TEXT NOT NULL DEFAULT '',
  "asin" TEXT NOT NULL DEFAULT '',
  "parentAsin" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT '',
  "saleQuantity" INTEGER NOT NULL DEFAULT 0,
  "fbaQuantity" INTEGER NOT NULL DEFAULT 0,
  "fbmQuantity" INTEGER NOT NULL DEFAULT 0,
  "saleRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grossProfitRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "adCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "refundRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxProductDailySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellfoxProductDailySnapshot_storeId_reportDate_sourceKey_key" ON "SellfoxProductDailySnapshot"("storeId", "reportDate", "sourceKey");
CREATE INDEX "SellfoxProductDailySnapshot_organizationId_workspaceId_reportDate_idx" ON "SellfoxProductDailySnapshot"("organizationId", "workspaceId", "reportDate");
CREATE INDEX "SellfoxProductDailySnapshot_storeId_reportDate_saleRevenue_idx" ON "SellfoxProductDailySnapshot"("storeId", "reportDate", "saleRevenue");
CREATE INDEX "SellfoxProductDailySnapshot_organizationId_workspaceId_msku_idx" ON "SellfoxProductDailySnapshot"("organizationId", "workspaceId", "msku");
CREATE INDEX "SellfoxProductDailySnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxProductDailySnapshot"("organizationId", "workspaceId", "asin");
ALTER TABLE "SellfoxProductDailySnapshot" ADD CONSTRAINT "SellfoxProductDailySnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
