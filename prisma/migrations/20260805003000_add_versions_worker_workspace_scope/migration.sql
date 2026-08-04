CREATE TYPE "WorkerHeartbeatStatus" AS ENUM ('online', 'stopping', 'offline');

CREATE TABLE "WorkspaceScope" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceScope_pkey" PRIMARY KEY ("organizationId", "id")
);

INSERT INTO "WorkspaceScope" ("organizationId", "id", "name", "isDefault", "updatedAt")
SELECT "id", 'default', '默认工作区', true, CURRENT_TIMESTAMP
FROM "Organization"
ON CONFLICT ("organizationId", "id") DO NOTHING;

ALTER TABLE "FileObject" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "FileObject" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FileObject" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ImportJob" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ImportJob" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ImportJob" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ExportRecord" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ExportRecord" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ExportRecord" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ProductRecord" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductRecord" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductImageCopyGalleryRecord" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ProductImageCopyGalleryRecord" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductImageCopyGalleryRecord" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiModelSetting" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "AiModelSetting" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiModelSetting" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ListingAiWorkspace" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ListingAiWorkspace" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ListingAiWorkspace" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkspaceSnapshot" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "WorkspaceSnapshot" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkspaceSnapshot" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaihuSearchMergeHistoryRecord" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "SaihuSearchMergeHistoryRecord" ADD COLUMN "accountId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaihuSearchMergeHistoryRecord" ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "ProductRecord_organizationId_sku_key";
DROP INDEX IF EXISTS "ProductImageCopyGalleryRecord_organizationId_sku_key";
DROP INDEX IF EXISTS "AiModelSetting_organizationId_userId_key";
DROP INDEX IF EXISTS "ListingAiWorkspace_organizationId_userId_key";
DROP INDEX IF EXISTS "WorkspaceSnapshot_organizationId_userId_key";

CREATE UNIQUE INDEX "ProductRecord_organizationId_workspaceId_sku_key" ON "ProductRecord"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductRecord_organizationId_workspaceId_updatedAt_idx" ON "ProductRecord"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "ProductRecord_organizationId_accountId_marketplace_updatedAt_idx" ON "ProductRecord"("organizationId", "accountId", "marketplace", "updatedAt");
CREATE INDEX "ProductRecord_organizationId_sku_idx" ON "ProductRecord"("organizationId", "sku");

CREATE UNIQUE INDEX "ProductImageCopyGalleryRecord_organizationId_workspaceId_sku_key" ON "ProductImageCopyGalleryRecord"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductImageCopyGalleryRecord_organizationId_workspaceId_updatedAt_idx" ON "ProductImageCopyGalleryRecord"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "ProductImageCopyGalleryRecord_organizationId_accountId_marketplace_updatedAt_idx" ON "ProductImageCopyGalleryRecord"("organizationId", "accountId", "marketplace", "updatedAt");

CREATE UNIQUE INDEX "AiModelSetting_organizationId_workspaceId_userId_key" ON "AiModelSetting"("organizationId", "workspaceId", "userId");
CREATE INDEX "AiModelSetting_organizationId_workspaceId_updatedAt_idx" ON "AiModelSetting"("organizationId", "workspaceId", "updatedAt");

CREATE UNIQUE INDEX "ListingAiWorkspace_organizationId_workspaceId_userId_key" ON "ListingAiWorkspace"("organizationId", "workspaceId", "userId");
CREATE INDEX "ListingAiWorkspace_organizationId_workspaceId_updatedAt_idx" ON "ListingAiWorkspace"("organizationId", "workspaceId", "updatedAt");

CREATE UNIQUE INDEX "WorkspaceSnapshot_organizationId_workspaceId_userId_key" ON "WorkspaceSnapshot"("organizationId", "workspaceId", "userId");
CREATE INDEX "WorkspaceSnapshot_organizationId_workspaceId_updatedAt_idx" ON "WorkspaceSnapshot"("organizationId", "workspaceId", "updatedAt");

CREATE INDEX "FileObject_organizationId_workspaceId_createdAt_idx" ON "FileObject"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "FileObject_organizationId_accountId_marketplace_createdAt_idx" ON "FileObject"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX "ImportJob_organizationId_workspaceId_createdAt_idx" ON "ImportJob"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "ImportJob_organizationId_accountId_marketplace_createdAt_idx" ON "ImportJob"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX "ExportRecord_organizationId_workspaceId_createdAt_idx" ON "ExportRecord"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "ExportRecord_organizationId_accountId_marketplace_createdAt_idx" ON "ExportRecord"("organizationId", "accountId", "marketplace", "createdAt");
CREATE INDEX "SaihuSearchMergeHistoryRecord_organizationId_workspaceId_createdAt_idx" ON "SaihuSearchMergeHistoryRecord"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "SaihuSearchMergeHistoryRecord_organizationId_accountId_marketplace_createdAt_idx" ON "SaihuSearchMergeHistoryRecord"("organizationId", "accountId", "marketplace", "createdAt");

CREATE TABLE "DataChangeVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "summary" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataChangeVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataChangeVersion_organizationId_entityType_entityId_version_key" ON "DataChangeVersion"("organizationId", "entityType", "entityId", "version");
CREATE INDEX "DataChangeVersion_organizationId_entityType_entityId_createdAt_idx" ON "DataChangeVersion"("organizationId", "entityType", "entityId", "createdAt");
CREATE INDEX "DataChangeVersion_organizationId_workspaceId_entityType_createdAt_idx" ON "DataChangeVersion"("organizationId", "workspaceId", "entityType", "createdAt");
CREATE INDEX "DataChangeVersion_userId_createdAt_idx" ON "DataChangeVersion"("userId", "createdAt");

CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workerName" TEXT NOT NULL,
  "queueName" TEXT NOT NULL,
  "status" "WorkerHeartbeatStatus" NOT NULL DEFAULT 'online',
  "concurrency" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerHeartbeat_queueName_lastSeenAt_idx" ON "WorkerHeartbeat"("queueName", "lastSeenAt");
CREATE INDEX "WorkerHeartbeat_organizationId_lastSeenAt_idx" ON "WorkerHeartbeat"("organizationId", "lastSeenAt");

ALTER TABLE "WorkspaceScope" ADD CONSTRAINT "WorkspaceScope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataChangeVersion" ADD CONSTRAINT "DataChangeVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataChangeVersion" ADD CONSTRAINT "DataChangeVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
