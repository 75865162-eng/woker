-- P1 additive Orders 2026-01-01 schema. No backfill or live activation.
-- Keep legacy mode constraints intact and extend only the new resource branch.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders') AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR ("sourceId" IS NOT NULL AND "resource" IN ('inventory','catalog','sales_traffic','orders')
  AND (("resource" = 'sales_traffic' AND "mode" = 'date_range') OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot') OR ("resource" = 'orders' AND "mode" = 'incremental'))
  AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
  AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
  AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')));
-- AlterTable
ALTER TABLE "AmazonSyncRun" ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AmazonSpApiAuthorization" ADD COLUMN     "approvedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rolesAttestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AmazonSyncDataSource" ADD COLUMN     "orderPolicy" JSONB;

-- CreateTable
CREATE TABLE "AmazonOrderRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "createdTime" TIMESTAMPTZ(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "rawStatus" TEXT,
    "normalizedStatus" TEXT,
    "marketplaceTimeZone" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonOrderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncResourceCursor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "watermarkFrom" TIMESTAMPTZ(3) NOT NULL,
    "watermarkTo" TIMESTAMPTZ(3) NOT NULL,
    "nextTokenCiphertext" TEXT,
    "activeRunId" TEXT,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSyncResourceCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncRawPage" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "resource" TEXT NOT NULL,
    "requestMetadata" JSONB NOT NULL,
    "rawCiphertext" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonSyncRawPage_pkey" PRIMARY KEY ("taskId","page")
);

-- CreateTable
CREATE TABLE "AmazonSyncTokenBucket" (
    "bucketKey" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "replenishedAt" TIMESTAMPTZ(3) NOT NULL,
    "blockedUntil" TIMESTAMPTZ(3),
    "observedLimit" DOUBLE PRECISION,

    CONSTRAINT "AmazonSyncTokenBucket_pkey" PRIMARY KEY ("bucketKey")
);

-- CreateIndex
CREATE INDEX "AmazonOrder_source_updated_idx" ON "AmazonOrderRecord"("organizationId", "workspaceId", "sourceId", "sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonOrder_scope_business_key" ON "AmazonOrderRecord"("organizationId", "workspaceId", "amazonSellerId", "marketplaceId", "amazonOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSyncResourceCursor_sourceId_key" ON "AmazonSyncResourceCursor"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonCursor_scope_resource_key" ON "AmazonSyncResourceCursor"("organizationId", "workspaceId", "resource", "amazonSellerId", "marketplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonCursor_scope_source_key" ON "AmazonSyncResourceCursor"("organizationId", "workspaceId", "sourceId");

-- AddForeignKey
ALTER TABLE "AmazonOrderRecord" ADD CONSTRAINT "AmazonOrderRecord_organizationId_workspaceId_sourceId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonOrderRecord" ADD CONSTRAINT "AmazonOrderRecord_sourceRunId_organizationId_workspaceId_s_fkey" FOREIGN KEY ("sourceRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncResourceCursor" ADD CONSTRAINT "AmazonSyncResourceCursor_organizationId_workspaceId_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncResourceCursor" ADD CONSTRAINT "AmazonSyncResourceCursor_activeRunId_organizationId_worksp_fkey" FOREIGN KEY ("activeRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncRawPage" ADD CONSTRAINT "AmazonSyncRawPage_organizationId_workspaceId_taskId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "taskId") REFERENCES "AmazonSyncRun"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
