-- Additive only. Manual review and separate execution approval required.
CREATE TABLE "AmazonSalesTrafficSnapshot" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "businessDate" VARCHAR(10) NOT NULL,
  "reportId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "quality" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonSalesTraffic_task_fkey" FOREIGN KEY ("syncRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun" ("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSalesTraffic_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSalesTraffic_quality_check" CHECK ("quality" IN ('VALID', 'MISSING_FIELDS')),
  CONSTRAINT "AmazonSalesTraffic_date_check" CHECK ("businessDate" ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE UNIQUE INDEX "AmazonSalesTraffic_run_date_key" ON "AmazonSalesTrafficSnapshot" ("organizationId", "workspaceId", "syncRunId", "businessDate");
CREATE INDEX "AmazonSalesTraffic_scope_date_idx" ON "AmazonSalesTrafficSnapshot" ("organizationId", "workspaceId", "sourceId", "businessDate");
ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR ("sourceId" IS NOT NULL AND "resource" IN ('inventory','catalog','sales_traffic')
  AND (("resource" = 'sales_traffic' AND "mode" = 'date_range') OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot'))
  AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
  AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
  AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')));
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic') AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0);
CREATE TABLE "AmazonDataExport" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "query" JSONB NOT NULL, "cutoff" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "fileId" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), "leaseExpiresAt" TIMESTAMP(3), "fence" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AmazonDataExport_file_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataExport_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataExport_actor_fkey" FOREIGN KEY ("organizationId", "requestedByUserId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonDataExport_status_check" CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED'))
);
CREATE UNIQUE INDEX "AmazonDataExport_idempotency_key" ON "AmazonDataExport"("organizationId", "workspaceId", "requestedByUserId", "idempotencyKey");
CREATE INDEX "AmazonDataExport_status_createdAt_idx" ON "AmazonDataExport"(status, "createdAt");
