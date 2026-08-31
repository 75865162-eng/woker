CREATE TABLE IF NOT EXISTS "SellfoxProductRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "accountId" TEXT NOT NULL DEFAULT '',
    "marketplace" TEXT NOT NULL DEFAULT '',
    "chineseName" TEXT NOT NULL DEFAULT '',
    "englishName" TEXT NOT NULL DEFAULT '',
    "asin" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL DEFAULT '',
    "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selectionOwner" TEXT NOT NULL DEFAULT '',
    "opsAssignee" TEXT NOT NULL DEFAULT '',
    "designerAssignee" TEXT NOT NULL DEFAULT '',
    "workflowStage" TEXT NOT NULL DEFAULT '',
    "workflowDueAt" TIMESTAMP(3),
    "operationsProgressIncomplete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SellfoxProductRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_sku_key" ON "SellfoxProductRecord"("organizationId", "workspaceId", "sku");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_updatedAt_idx" ON "SellfoxProductRecord"("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_updatedAt_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_sku_idx" ON "SellfoxProductRecord"("organizationId", "sku");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_userId_updatedAt_idx" ON "SellfoxProductRecord"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_accountId_marketplace_upda" ON "SellfoxProductRecord"("organizationId", "accountId", "marketplace", "updatedAt");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_asin_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "asin");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_chineseName_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "chineseName");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_designerAssignee_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "designerAssignee");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_operationsPro" ON "SellfoxProductRecord"("organizationId", "workspaceId", "operationsProgressIncomplete");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_opsAssignee_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "opsAssignee");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_purchasePrice_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "purchasePrice");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_selectionOwner_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "selectionOwner");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_status_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "status");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_supplierName_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "supplierName");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_workflowDueAt_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "workflowDueAt");
CREATE INDEX IF NOT EXISTS "SellfoxProductRecord_organizationId_workspaceId_workflowStage_idx" ON "SellfoxProductRecord"("organizationId", "workspaceId", "workflowStage");

DO $$ BEGIN
    ALTER TABLE "SellfoxProductRecord"
        ADD CONSTRAINT "SellfoxProductRecord_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "SellfoxProductRecord"
        ADD CONSTRAINT "SellfoxProductRecord_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
