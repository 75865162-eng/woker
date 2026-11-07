-- Amazon Data Hub fact tables (independent of ProductRecord)
CREATE TABLE "AmazonDataHubConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplaceCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT '',
    "profileName" TEXT NOT NULL DEFAULT '',
    "sellfoxStoreId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonDataHubConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonDataHubConnection_organizationId_workspaceId_marketplaceCode_profileId_key"
  ON "AmazonDataHubConnection"("organizationId", "workspaceId", "marketplaceCode", "profileId");
CREATE INDEX "AmazonDataHubConnection_organizationId_workspaceId_updatedAt_idx"
  ON "AmazonDataHubConnection"("organizationId", "workspaceId", "updatedAt");

CREATE TABLE "AmazonDataHubFreshness" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplaceCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT '',
    "dataset" TEXT NOT NULL,
    "asOf" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "warnings" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonDataHubFreshness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonDataHubFreshness_organizationId_workspaceId_marketplaceCode_profileId_dataset_key"
  ON "AmazonDataHubFreshness"("organizationId", "workspaceId", "marketplaceCode", "profileId", "dataset");
CREATE INDEX "AmazonDataHubFreshness_organizationId_workspaceId_dataset_idx"
  ON "AmazonDataHubFreshness"("organizationId", "workspaceId", "dataset");

CREATE TABLE "AmazonSkuOpsDailyFact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplaceCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT '',
    "reportDate" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "msku" TEXT NOT NULL DEFAULT '',
    "asin" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "saleQuantity" INTEGER NOT NULL DEFAULT 0,
    "saleRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fbaQuantity" INTEGER NOT NULL DEFAULT 0,
    "fbmQuantity" INTEGER NOT NULL DEFAULT 0,
    "daysOfCover" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'sellfox.product_daily',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonSkuOpsDailyFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonSkuOpsDailyFact_organizationId_workspaceId_marketplaceCode_reportDate_sourceRef_key"
  ON "AmazonSkuOpsDailyFact"("organizationId", "workspaceId", "marketplaceCode", "reportDate", "sourceRef");
CREATE INDEX "AmazonSkuOpsDailyFact_organizationId_workspaceId_reportDate_adCost_idx"
  ON "AmazonSkuOpsDailyFact"("organizationId", "workspaceId", "reportDate", "adCost");
CREATE INDEX "AmazonSkuOpsDailyFact_organizationId_workspaceId_asin_idx"
  ON "AmazonSkuOpsDailyFact"("organizationId", "workspaceId", "asin");
CREATE INDEX "AmazonSkuOpsDailyFact_organizationId_workspaceId_msku_idx"
  ON "AmazonSkuOpsDailyFact"("organizationId", "workspaceId", "msku");

CREATE TABLE "AmazonPpcWriteIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "marketplaceCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "warningsJson" JSONB,
    "dataVersion" TEXT NOT NULL DEFAULT '',
    "amazonRequestId" TEXT NOT NULL DEFAULT '',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "actorUserId" TEXT NOT NULL DEFAULT '',
    "approverUserId" TEXT NOT NULL DEFAULT '',
    "outboxEventId" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonPpcWriteIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonPpcWriteIntent_organizationId_idempotencyKey_key"
  ON "AmazonPpcWriteIntent"("organizationId", "idempotencyKey");
CREATE INDEX "AmazonPpcWriteIntent_organizationId_workspaceId_status_createdAt_idx"
  ON "AmazonPpcWriteIntent"("organizationId", "workspaceId", "status", "createdAt");
CREATE INDEX "AmazonPpcWriteIntent_organizationId_profileId_createdAt_idx"
  ON "AmazonPpcWriteIntent"("organizationId", "profileId", "createdAt");
