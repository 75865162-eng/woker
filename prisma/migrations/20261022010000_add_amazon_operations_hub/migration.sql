CREATE TABLE "AmazonIntegrationConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'amazon_sp_api',
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "enabledDomains" JSONB NOT NULL DEFAULT '[]',
    "marketplaceParticipations" JSONB NOT NULL DEFAULT '[]',
    "statusMessage" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonIntegrationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonSyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "requestedByUserId" TEXT NOT NULL,
    "resource" TEXT NOT NULL DEFAULT 'readiness',
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "summary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonInventorySnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "syncRunId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "asin" TEXT NOT NULL DEFAULT '',
    "fnSku" TEXT NOT NULL DEFAULT '',
    "condition" TEXT NOT NULL DEFAULT '',
    "fulfillableQuantity" INTEGER NOT NULL DEFAULT 0,
    "inboundWorkingQuantity" INTEGER NOT NULL DEFAULT 0,
    "inboundShippedQuantity" INTEGER NOT NULL DEFAULT 0,
    "inboundReceivingQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unfulfillableQuantity" INTEGER NOT NULL DEFAULT 0,
    "researchingQuantity" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonInventorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonIntegrationConnection_organizationId_workspaceId_provider_key"
  ON "AmazonIntegrationConnection"("organizationId", "workspaceId", "provider");
CREATE INDEX "AmazonIntegrationConnection_organizationId_workspaceId_updatedAt_idx"
  ON "AmazonIntegrationConnection"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "AmazonSyncRun_organizationId_workspaceId_startedAt_idx"
  ON "AmazonSyncRun"("organizationId", "workspaceId", "startedAt");
CREATE INDEX "AmazonSyncRun_organizationId_workspaceId_status_updatedAt_idx"
  ON "AmazonSyncRun"("organizationId", "workspaceId", "status", "updatedAt");
CREATE UNIQUE INDEX "AmazonSyncRun_organizationId_workspaceId_idempotencyKey_key"
  ON "AmazonSyncRun"("organizationId", "workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "AmazonInventorySnapshot_syncRunId_marketplaceId_sellerSku_condition_key"
  ON "AmazonInventorySnapshot"("syncRunId", "marketplaceId", "sellerSku", "condition");
CREATE INDEX "AmazonInventorySnapshot_organizationId_workspaceId_marketplaceId_capturedAt_idx"
  ON "AmazonInventorySnapshot"("organizationId", "workspaceId", "marketplaceId", "capturedAt");
CREATE INDEX "AmazonInventorySnapshot_organizationId_workspaceId_sellerSku_capturedAt_idx"
  ON "AmazonInventorySnapshot"("organizationId", "workspaceId", "sellerSku", "capturedAt");
CREATE INDEX "AmazonInventorySnapshot_syncRunId_idx"
  ON "AmazonInventorySnapshot"("syncRunId");
