-- Add settlement discovery, FBA reimbursements, and inventory-age report facts.
-- This is an additive migration; report/source execution stays behind current approval gates.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age')
  AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0
);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR (
    "sourceId" IS NOT NULL
    AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns','settlements','reimbursements','inventory_age')
    AND (("resource" = 'sales_traffic' AND "mode" = 'date_range')
      OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot')
      OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental')
      OR ("resource" IN ('settlements','reimbursements','inventory_age') AND "mode" = 'report'))
    AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
    AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
    AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')
  )
);

CREATE TABLE "AmazonSyncReportDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "amazonSellerId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "reportCreatedAt" TIMESTAMPTZ(3),
  "businessDateField" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "capturedAt" TIMESTAMPTZ(3) NOT NULL,
  "publishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AmazonSyncReportDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonReport_resource_type_check" CHECK (
    ("resource" = 'settlements' AND "reportType" = 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2') OR
    ("resource" = 'reimbursements' AND "reportType" = 'GET_FBA_REIMBURSEMENTS_DATA') OR
    ("resource" = 'inventory_age' AND "reportType" = 'GET_FBA_INVENTORY_PLANNING_DATA')
  ),
  CONSTRAINT "AmazonReport_counts_status_check" CHECK ("rowCount" >= 0 AND "status" IN ('STAGED','PUBLISHED')),
  CONSTRAINT "AmazonReport_scope_id_key" UNIQUE ("organizationId", "workspaceId", "sourceId", "reportId", "id"),
  CONSTRAINT "AmazonReport_business_key" UNIQUE ("organizationId", "workspaceId", "sourceId", "reportId"),
  CONSTRAINT "AmazonReport_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonReport_run_fkey" FOREIGN KEY ("sourceRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun" ("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AmazonReport_source_published_idx" ON "AmazonSyncReportDocument" ("organizationId", "workspaceId", "sourceId", "resource", "publishedAt");

CREATE TABLE "AmazonSyncReportRow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "reportDocumentId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rowHash" TEXT NOT NULL,
  "businessDateRaw" TEXT,
  "businessDate" VARCHAR(10),
  "orderId" TEXT,
  "sellerSku" TEXT,
  "asin" TEXT,
  "transactionType" TEXT,
  "amountType" TEXT,
  "amountDescription" TEXT,
  "amountOriginal" TEXT,
  "currencyCode" TEXT,
  "quantityOriginal" TEXT,
  "fields" JSONB NOT NULL,
  CONSTRAINT "AmazonSyncReportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonReportRow_number_check" CHECK ("rowNumber" > 0),
  CONSTRAINT "AmazonReportRow_document_row_key" UNIQUE ("reportDocumentId", "rowNumber"),
  CONSTRAINT "AmazonReportRow_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonReportRow_document_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId", "reportId", "reportDocumentId") REFERENCES "AmazonSyncReportDocument" ("organizationId", "workspaceId", "sourceId", "reportId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AmazonReportRow_source_date_idx" ON "AmazonSyncReportRow" ("organizationId", "workspaceId", "sourceId", "businessDate");
CREATE INDEX "AmazonReportRow_source_order_idx" ON "AmazonSyncReportRow" ("organizationId", "workspaceId", "sourceId", "orderId");
CREATE INDEX "AmazonReportRow_source_sku_idx" ON "AmazonSyncReportRow" ("organizationId", "workspaceId", "sourceId", "sellerSku");
CREATE INDEX "AmazonReportRow_source_asin_idx" ON "AmazonSyncReportRow" ("organizationId", "workspaceId", "sourceId", "asin");
