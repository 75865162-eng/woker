CREATE TABLE "SellfoxFbaInventorySnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "storeId" TEXT NOT NULL,
  "reportDate" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "msku" TEXT NOT NULL DEFAULT '',
  "asin" TEXT NOT NULL DEFAULT '',
  "fnsku" TEXT NOT NULL DEFAULT '',
  "quantity" INTEGER,
  "payload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxFbaInventorySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellfoxFbaInventorySnapshot_storeId_capturedAt_sourceKey_key" ON "SellfoxFbaInventorySnapshot"("storeId", "capturedAt", "sourceKey");
CREATE INDEX "SellfoxFbaInventorySnapshot_organizationId_workspaceId_reportDate_idx" ON "SellfoxFbaInventorySnapshot"("organizationId", "workspaceId", "reportDate");
CREATE INDEX "SellfoxFbaInventorySnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxFbaInventorySnapshot"("organizationId", "workspaceId", "asin");
CREATE INDEX "SellfoxFbaInventorySnapshot_organizationId_workspaceId_msku_idx" ON "SellfoxFbaInventorySnapshot"("organizationId", "workspaceId", "msku");
ALTER TABLE "SellfoxFbaInventorySnapshot" ADD CONSTRAINT "SellfoxFbaInventorySnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SellfoxSalesDailySnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "storeId" TEXT NOT NULL,
  "reportDate" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "msku" TEXT NOT NULL DEFAULT '',
  "asin" TEXT NOT NULL DEFAULT '',
  "quantity" INTEGER,
  "revenue" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT '',
  "payload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxSalesDailySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellfoxSalesDailySnapshot_storeId_reportDate_sourceKey_key" ON "SellfoxSalesDailySnapshot"("storeId", "reportDate", "sourceKey");
CREATE INDEX "SellfoxSalesDailySnapshot_organizationId_workspaceId_reportDate_idx" ON "SellfoxSalesDailySnapshot"("organizationId", "workspaceId", "reportDate");
CREATE INDEX "SellfoxSalesDailySnapshot_organizationId_workspaceId_asin_idx" ON "SellfoxSalesDailySnapshot"("organizationId", "workspaceId", "asin");
CREATE INDEX "SellfoxSalesDailySnapshot_organizationId_workspaceId_msku_idx" ON "SellfoxSalesDailySnapshot"("organizationId", "workspaceId", "msku");
ALTER TABLE "SellfoxSalesDailySnapshot" ADD CONSTRAINT "SellfoxSalesDailySnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SellfoxSyncSchedule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL,
  "lastEnqueuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxSyncSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellfoxSyncSchedule_organizationId_workspaceId_resource_key" ON "SellfoxSyncSchedule"("organizationId", "workspaceId", "resource");
CREATE INDEX "SellfoxSyncSchedule_enabled_lastEnqueuedAt_idx" ON "SellfoxSyncSchedule"("enabled", "lastEnqueuedAt");
