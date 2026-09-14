CREATE TYPE "ProductProjectionName" AS ENUM ('summary', 'text', 'list_summary', 'product_center');
CREATE TYPE "ProductProjectionStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

CREATE TABLE "ProductProjectionState" (
  "id" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "projectionName" "ProductProjectionName" NOT NULL,
  "status" "ProductProjectionStatus" NOT NULL DEFAULT 'pending',
  "sourceRevision" INTEGER,
  "projectionVersion" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastStartedAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductProjectionState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductProjectionFailure" (
  "id" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "projectionName" "ProductProjectionName" NOT NULL,
  "sourceRevision" INTEGER,
  "projectionVersion" INTEGER,
  "attempt" INTEGER NOT NULL,
  "error" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductProjectionFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductProjectionState_productRecordId_projectionName_key"
  ON "ProductProjectionState"("productRecordId", "projectionName");
CREATE INDEX "ProductProjectionState_org_workspace_status_updated_idx"
  ON "ProductProjectionState"("organizationId", "workspaceId", "status", "updatedAt");
CREATE INDEX "ProductProjectionState_org_workspace_projection_status_updated_idx"
  ON "ProductProjectionState"("organizationId", "workspaceId", "projectionName", "status", "updatedAt");
CREATE INDEX "ProductProjectionFailure_org_workspace_record_created_idx"
  ON "ProductProjectionFailure"("organizationId", "workspaceId", "productRecordId", "createdAt");
CREATE INDEX "ProductProjectionFailure_org_workspace_projection_created_idx"
  ON "ProductProjectionFailure"("organizationId", "workspaceId", "projectionName", "createdAt");

ALTER TABLE "ProductProjectionState"
  ADD CONSTRAINT "ProductProjectionState_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductProjectionState"
  ADD CONSTRAINT "ProductProjectionState_productRecordId_fkey"
  FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductProjectionFailure"
  ADD CONSTRAINT "ProductProjectionFailure_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductProjectionFailure"
  ADD CONSTRAINT "ProductProjectionFailure_productRecordId_fkey"
  FOREIGN KEY ("productRecordId") REFERENCES "ProductRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
