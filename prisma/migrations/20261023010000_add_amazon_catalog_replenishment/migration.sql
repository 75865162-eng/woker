ALTER TABLE "AmazonInventorySnapshot" ADD COLUMN "sellerAccountId" TEXT;
-- Earlier SQL and Prisma-generated schemas used different truncation conventions.
DROP INDEX IF EXISTS "AmazonInventorySnapshot_syncRunId_marketplaceId_sellerSku_condition_key";
DROP INDEX IF EXISTS "AmazonInventorySnapshot_syncRunId_marketplaceId_sellerSku_c_key";
CREATE UNIQUE INDEX "AmazonInventorySnapshot_run_store_sku_key" ON "AmazonInventorySnapshot" ("syncRunId", "marketplaceId", "sellerAccountId", "sellerSku", "condition");
CREATE INDEX "AmazonInventorySnapshot_store_sku_captured_idx" ON "AmazonInventorySnapshot" ("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku", "capturedAt");
CREATE TABLE "AmazonCatalogSnapshot" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL DEFAULT 'default',
 "sellerAccountId" TEXT NOT NULL, "marketplaceId" TEXT NOT NULL, "sellerSku" TEXT NOT NULL,
 "asin" TEXT NOT NULL DEFAULT '', "listingStatus" TEXT, "fulfillmentType" TEXT,
 "sourceRunId" TEXT NOT NULL, "fieldSources" JSONB NOT NULL, "capturedAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AmazonCatalogSnapshot_run_store_sku_key" ON "AmazonCatalogSnapshot" ("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku", "sourceRunId");
CREATE INDEX "AmazonCatalogSnapshot_store_sku_captured_idx" ON "AmazonCatalogSnapshot" ("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku", "capturedAt");
CREATE INDEX "AmazonCatalogSnapshot_sourceRunId_idx" ON "AmazonCatalogSnapshot" ("sourceRunId");
ALTER TABLE "AmazonSyncSchedule" DROP CONSTRAINT "AmazonSchedule_supported_enabled";
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (NOT "enabled" OR "resource" IN ('inventory', 'catalog'));
CREATE TABLE "AmazonReplenishmentPolicy" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL DEFAULT 'default',
 "sellerAccountId" TEXT NOT NULL, "marketplaceId" TEXT NOT NULL, "sellerSku" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "inputs" JSONB NOT NULL, "updatedByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AmazonReplenishmentPolicy_store_sku_key" ON "AmazonReplenishmentPolicy" ("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "sellerSku");
CREATE INDEX "AmazonReplenishmentPolicy_enabled_idx" ON "AmazonReplenishmentPolicy" ("enabled", "updatedAt");
CREATE TABLE "AmazonReplenishmentPlan" (
 "id" TEXT PRIMARY KEY, "policyId" TEXT NOT NULL UNIQUE, "organizationId" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL DEFAULT 'default', "sellerAccountId" TEXT NOT NULL, "marketplaceId" TEXT NOT NULL,
 "sellerSku" TEXT NOT NULL, "policyUpdatedAt" TIMESTAMP(3) NOT NULL, "inventoryRunId" TEXT,
 "inputSnapshot" JSONB NOT NULL, "lastError" TEXT, "result" JSONB NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL, "nextCalculationAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AmazonReplenishmentPlan_scope_generated_idx" ON "AmazonReplenishmentPlan" ("organizationId", "workspaceId", "generatedAt");
