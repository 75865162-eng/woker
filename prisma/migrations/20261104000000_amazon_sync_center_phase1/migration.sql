-- DropIndex
DROP INDEX "AmazonSchedule_scope_resource_key";

-- AlterTable
ALTER TABLE "AmazonSyncRun" ADD COLUMN     "apiRequests" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "authorizationRevision" INTEGER,
ADD COLUMN     "checkpointCiphertext" TEXT,
ADD COLUMN     "control" TEXT,
ADD COLUMN     "dispatchVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "executionStartedAt" TIMESTAMP(3),
ADD COLUMN     "executionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "fenceVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "insertedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'snapshot',
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "pagesCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paginationComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "processedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "scheduleRevision" INTEGER,
ADD COLUMN     "skippedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'WAITING',
ADD COLUMN     "throttles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trigger" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "updatedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AmazonInventorySnapshot" ADD COLUMN     "dataVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AmazonCatalogSnapshot" ADD COLUMN     "dataVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AmazonSyncSchedule" ADD COLUMN     "executionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'snapshot',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "planKey" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AmazonSpApiAuthorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "awsRegion" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "credentialsCiphertext" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "marketplaceParticipations" JSONB NOT NULL DEFAULT '[]',
    "lastValidatedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSpApiAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncDataSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "authorizationId" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'amazon_sp_api',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "freshnessMinutes" INTEGER NOT NULL,
    "activeRunId" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "coverage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSyncDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncPlanTarget" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "AmazonSyncPlanTarget_pkey" PRIMARY KEY ("scheduleId","sourceId")
);

-- CreateTable
CREATE TABLE "AmazonSyncTaskLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "page" INTEGER,
    "code" TEXT,
    "requestId" TEXT,
    "statusCode" INTEGER,
    "rateLimit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSyncTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncPage" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSyncPage_pkey" PRIMARY KEY ("taskId","page")
);

-- CreateTable
CREATE TABLE "AmazonSyncApiBudget" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "nextRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observedLimit" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSyncApiBudget_pkey" PRIMARY KEY ("organizationId","workspaceId","authorizationId","operation")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonAuth_scope_id_key" ON "AmazonSpApiAuthorization"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonAuth_seller_region_key" ON "AmazonSpApiAuthorization"("organizationId", "workspaceId", "amazonSellerId", "awsRegion");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSource_scope_id_key" ON "AmazonSyncDataSource"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSource_store_site_domain_key" ON "AmazonSyncDataSource"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "resource");

-- CreateIndex
CREATE INDEX "AmazonTaskLog_task_time_idx" ON "AmazonSyncTaskLog"("organizationId", "workspaceId", "taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSyncPage_token_key" ON "AmazonSyncPage"("taskId", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SellerAccount_sync_scope_id_key" ON "SellerAccount"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE INDEX "AmazonSyncRun_dispatch_idx" ON "AmazonSyncRun"("executionVersion", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AmazonSyncRun_source_started_idx" ON "AmazonSyncRun"("sourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonRun_source_scope_id_key" ON "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSyncRun_scope_id_key" ON "AmazonSyncRun"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE INDEX "AmazonSchedule_v2_due_idx" ON "AmazonSyncSchedule"("executionVersion", "enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSchedule_scope_resource_plan_key" ON "AmazonSyncSchedule"("organizationId", "workspaceId", "resource", "planKey");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSchedule_scope_id_key" ON "AmazonSyncSchedule"("organizationId", "workspaceId", "id");

-- AddForeignKey
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_organizationId_workspaceId_sourceId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSyncDataSource_organizationId_workspaceId_authorizat_fkey" FOREIGN KEY ("organizationId", "workspaceId", "authorizationId") REFERENCES "AmazonSpApiAuthorization"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSyncDataSource_organizationId_workspaceId_sellerAcco_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sellerAccountId") REFERENCES "SellerAccount"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSyncDataSource_activeRunId_organizationId_workspaceI_fkey" FOREIGN KEY ("activeRunId", "organizationId", "workspaceId", "id") REFERENCES "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncPlanTarget" ADD CONSTRAINT "AmazonSyncPlanTarget_organizationId_workspaceId_scheduleId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "scheduleId") REFERENCES "AmazonSyncSchedule"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncPlanTarget" ADD CONSTRAINT "AmazonSyncPlanTarget_organizationId_workspaceId_sourceId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncTaskLog" ADD CONSTRAINT "AmazonSyncTaskLog_organizationId_workspaceId_taskId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "taskId") REFERENCES "AmazonSyncRun"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonSyncPage" ADD CONSTRAINT "AmazonSyncPage_organizationId_workspaceId_taskId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "taskId") REFERENCES "AmazonSyncRun"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- One active publisher per source. Application enqueue, control and publish also
-- serialize on a short scope advisory lock; this constraint is the final guard.
CREATE UNIQUE INDEX "AmazonSyncRun_one_active_source_key"
  ON "AmazonSyncRun" ("sourceId")
  WHERE "executionVersion" = 2 AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED');
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR ("sourceId" IS NOT NULL AND "resource" IN ('inventory','catalog')
  AND "mode" = 'snapshot' AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
  AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
  AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','FAILED','CANCELLED','BLOCKED')));
ALTER TABLE "AmazonSyncSchedule" ADD CONSTRAINT "AmazonSchedule_v2_policy" CHECK (
  "executionVersion" <> 2 OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot'
  AND "intervalMinutes" BETWEEN 15 AND 10080 AND "maxAttempts" BETWEEN 1 AND 10
  AND "priority" BETWEEN 1 AND 4 AND "retentionDays" BETWEEN 1 AND 3650));
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog') AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0);
-- Seller/authorization/site scope is enforced by compound foreign keys above.
-- Secret and checkpoint ciphertext are intentionally absent from all read DTOs.
