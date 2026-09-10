CREATE TYPE "ProductAttachmentStatus" AS ENUM ('temporary', 'linked', 'orphan');
CREATE TYPE "ProductOutboxStatus" AS ENUM ('queued', 'running', 'done', 'failed');

ALTER TABLE "FileObject"
  ADD COLUMN "productBindingStatus" "ProductAttachmentStatus";

ALTER TABLE "ProductRecord"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ProductSummaryRecord" (
  "id" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL,
  "asin" TEXT NOT NULL DEFAULT '',
  "chineseName" TEXT NOT NULL DEFAULT '',
  "englishName" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'dashboard',
  "primaryImageUrl" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "supplierName" TEXT NOT NULL DEFAULT '',
  "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "selectionOwner" TEXT NOT NULL DEFAULT '',
  "opsAssignee" TEXT NOT NULL DEFAULT '',
  "designerAssignee" TEXT NOT NULL DEFAULT '',
  "currentOwner" TEXT NOT NULL DEFAULT '',
  "workflowStage" TEXT NOT NULL DEFAULT '',
  "workflowDueAt" TIMESTAMP(3),
  "isOverdue" BOOLEAN NOT NULL DEFAULT false,
  "operationsProgressIncomplete" BOOLEAN NOT NULL DEFAULT false,
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "projectionVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSummaryRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductTextRecord" (
  "id" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "language" TEXT NOT NULL DEFAULT 'default',
  "developer" TEXT NOT NULL DEFAULT '',
  "supplierUrl" TEXT NOT NULL DEFAULT '',
  "specs" TEXT NOT NULL DEFAULT '',
  "purchaseLeadTime" TEXT NOT NULL DEFAULT '',
  "keywords" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "cancelReason" TEXT NOT NULL DEFAULT '',
  "hsCode" TEXT NOT NULL DEFAULT '',
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "projectionVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductTextRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAttachmentBinding" (
  "id" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "productSku" TEXT NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "status" "ProductAttachmentStatus" NOT NULL DEFAULT 'temporary',
  "linkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductAttachmentBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOutboxEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "accountId" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "ProductOutboxStatus" NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductAttachmentBinding_fileId_key"
  ON "ProductAttachmentBinding"("fileId");
CREATE UNIQUE INDEX "ProductSummaryRecord_productRecordId_key"
  ON "ProductSummaryRecord"("productRecordId");
CREATE UNIQUE INDEX "ProductSummaryRecord_organizationId_workspaceId_sku_key"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "sku");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_createdAt_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_updatedAt_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_source_updatedAt_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "source", "updatedAt");
CREATE INDEX "ProductSummaryRecord_org_workspace_source_status_updated"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "source", "status", "updatedAt");
CREATE INDEX "ProductSummaryRecord_org_workspace_source_owner_updated"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "source", "currentOwner", "updatedAt");
CREATE INDEX "ProductSummaryRecord_org_workspace_source_overdue_updated"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "source", "isOverdue", "updatedAt");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_asin_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "asin");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_chineseName_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "chineseName");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_supplierName_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "supplierName");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_purchasePrice_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "purchasePrice");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_selectionOwner_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "selectionOwner");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_opsAssignee_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "opsAssignee");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_designerAssignee_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "designerAssignee");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_workflowStage_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "workflowStage");
CREATE INDEX "ProductSummaryRecord_organizationId_workspaceId_workflowDueAt_idx"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "workflowDueAt");
CREATE INDEX "ProductSummaryRecord_org_workspace_operations_incomplete"
  ON "ProductSummaryRecord"("organizationId", "workspaceId", "operationsProgressIncomplete");
CREATE UNIQUE INDEX "ProductTextRecord_organizationId_workspaceId_productRecordId_l_key"
  ON "ProductTextRecord"("organizationId", "workspaceId", "productRecordId", "language");
CREATE INDEX "ProductTextRecord_organizationId_workspaceId_updatedAt_idx"
  ON "ProductTextRecord"("organizationId", "workspaceId", "updatedAt");
CREATE INDEX "ProductTextRecord_organizationId_workspaceId_language_updatedAt_idx"
  ON "ProductTextRecord"("organizationId", "workspaceId", "language", "updatedAt");
CREATE INDEX "ProductAttachmentBinding_org_workspace_status_updated_idx"
  ON "ProductAttachmentBinding"("organizationId", "workspaceId", "status", "updatedAt");
CREATE INDEX "ProductAttachmentBinding_org_workspace_product_status_idx"
  ON "ProductAttachmentBinding"("organizationId", "workspaceId", "productSku", "status");
CREATE INDEX "ProductOutboxEvent_status_availableAt_idx"
  ON "ProductOutboxEvent"("status", "availableAt");
CREATE INDEX "ProductOutboxEvent_org_workspace_createdAt_idx"
  ON "ProductOutboxEvent"("organizationId", "workspaceId", "createdAt");
CREATE INDEX "ProductOutboxEvent_entity_createdAt_idx"
  ON "ProductOutboxEvent"("entityType", "entityId", "createdAt");

ALTER TABLE "ProductAttachmentBinding"
  ADD CONSTRAINT "ProductAttachmentBinding_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAttachmentBinding"
  ADD CONSTRAINT "ProductAttachmentBinding_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSummaryRecord"
  ADD CONSTRAINT "ProductSummaryRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSummaryRecord"
  ADD CONSTRAINT "ProductSummaryRecord_productRecordId_fkey"
  FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTextRecord"
  ADD CONSTRAINT "ProductTextRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTextRecord"
  ADD CONSTRAINT "ProductTextRecord_productRecordId_fkey"
  FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOutboxEvent"
  ADD CONSTRAINT "ProductOutboxEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOutboxEvent"
  ADD CONSTRAINT "ProductOutboxEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProductSummaryRecord" (
  "id",
  "productRecordId",
  "organizationId",
  "workspaceId",
  "accountId",
  "marketplace",
  "sku",
  "asin",
  "chineseName",
  "englishName",
  "source",
  "primaryImageUrl",
  "status",
  "supplierName",
  "purchasePrice",
  "selectionOwner",
  "opsAssignee",
  "designerAssignee",
  "currentOwner",
  "workflowStage",
  "workflowDueAt",
  "isOverdue",
  "operationsProgressIncomplete",
  "sourceRevision",
  "projectionVersion",
  "sourceUpdatedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'psum_' || md5("organizationId" || ':' || "workspaceId" || ':' || id),
  id,
  "organizationId",
  "workspaceId",
  "accountId",
  "marketplace",
  sku,
  asin,
  "chineseName",
  "englishName",
  "source",
  COALESCE(NULLIF("payload"->'imageAssets'->0->>'thumbUrl', ''), NULLIF("payload"->>'image', ''), ''),
  status,
  "supplierName",
  "purchasePrice",
  "selectionOwner",
  "opsAssignee",
  "designerAssignee",
  "currentOwner",
  "workflowStage",
  "workflowDueAt",
  "isOverdue",
  "operationsProgressIncomplete",
  revision,
  1,
  "updatedAt",
  "createdAt",
  "updatedAt"
FROM "ProductRecord"
WHERE "source" = 'dashboard'
ON CONFLICT DO NOTHING;

INSERT INTO "ProductTextRecord" (
  "id",
  "productRecordId",
  "organizationId",
  "workspaceId",
  "language",
  "developer",
  "supplierUrl",
  "specs",
  "purchaseLeadTime",
  "keywords",
  "note",
  "cancelReason",
  "hsCode",
  "sourceRevision",
  "projectionVersion",
  "sourceUpdatedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'ptxt_' || md5("organizationId" || ':' || "workspaceId" || ':' || id || ':default'),
  id,
  "organizationId",
  "workspaceId",
  'default',
  COALESCE(NULLIF("payload"->>'developer', ''), ''),
  COALESCE(NULLIF("payload"->>'supplierUrl', ''), ''),
  COALESCE(NULLIF("payload"->>'specs', ''), ''),
  COALESCE(NULLIF("payload"->>'purchaseLeadTime', ''), ''),
  COALESCE(NULLIF("payload"->>'keywords', ''), ''),
  COALESCE(NULLIF("payload"->>'note', ''), ''),
  COALESCE(NULLIF("payload"->>'cancelReason', ''), ''),
  COALESCE(NULLIF("payload"->>'hsCode', ''), ''),
  revision,
  1,
  "updatedAt",
  "createdAt",
  "updatedAt"
FROM "ProductRecord"
WHERE "source" = 'dashboard'
ON CONFLICT DO NOTHING;
