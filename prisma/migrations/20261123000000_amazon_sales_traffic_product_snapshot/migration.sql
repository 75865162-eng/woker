-- Additive only. Product-day facts from single-day GET_SALES_AND_TRAFFIC_REPORT.
-- Layered separately from seller-day AmazonSalesTrafficSnapshot; never overwrites it.
-- Manual review and separate execution approval required.
CREATE TABLE IF NOT EXISTS "AmazonSalesTrafficProductSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "businessDate" VARCHAR(10) NOT NULL,
  "granularity" VARCHAR(10) NOT NULL,
  "childAsin" VARCHAR(20) NOT NULL,
  "parentAsin" VARCHAR(20),
  "sellerSku" VARCHAR(100),
  "reportId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "quality" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonSalesTrafficProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AmazonSalesTrafficProduct_task_fkey" FOREIGN KEY ("syncRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun" ("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSalesTrafficProduct_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AmazonSalesTrafficProduct_quality_check" CHECK ("quality" IN ('VALID', 'MISSING_FIELDS')),
  CONSTRAINT "AmazonSalesTrafficProduct_granularity_check" CHECK ("granularity" IN ('CHILD', 'SKU')),
  CONSTRAINT "AmazonSalesTrafficProduct_date_check" CHECK ("businessDate" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "AmazonSalesTrafficProduct_asin_check" CHECK ("childAsin" <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmazonSalesTrafficProduct_run_day_identity_key" ON "AmazonSalesTrafficProductSnapshot" ("organizationId", "workspaceId", "syncRunId", "businessDate", "granularity", "childAsin");
CREATE INDEX IF NOT EXISTS "AmazonSalesTrafficProduct_scope_day_idx" ON "AmazonSalesTrafficProductSnapshot" ("organizationId", "workspaceId", "sourceId", "businessDate", "granularity");
CREATE INDEX IF NOT EXISTS "AmazonSalesTrafficProduct_asin_idx" ON "AmazonSalesTrafficProductSnapshot" ("organizationId", "workspaceId", "sourceId", "granularity", "childAsin", "businessDate");
