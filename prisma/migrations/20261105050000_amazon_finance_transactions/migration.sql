-- P3 additive Finances 2024-06-19 schema. No backfill or live activation.
-- Keep legacy mode constraints intact and extend only the new resource branch.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance') AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR ("sourceId" IS NOT NULL AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance')
  AND (("resource" = 'sales_traffic' AND "mode" = 'date_range') OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot') OR ("resource" IN ('orders','finance') AND "mode" = 'incremental'))
  AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
  AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
  AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')));
-- AlterTable
ALTER TABLE "AmazonSyncDataSource" ADD COLUMN     "financePolicy" JSONB;

-- AlterTable
ALTER TABLE "AmazonSyncResourceCursor" ADD COLUMN     "captureSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AmazonFinanceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "marketplaceTimeZone" TEXT,
    "attributionStatus" TEXT NOT NULL,
    "quarantineReason" TEXT,
    "postedAt" TIMESTAMPTZ(3) NOT NULL,
    "transactionType" TEXT,
    "rawStatus" TEXT,
    "orderId" TEXT,
    "classification" TEXT NOT NULL,
    "originalAmount" TEXT,
    "amount" DECIMAL(65,30),
    "currency" TEXT,
    "convertedAmount" DECIMAL(65,30),
    "convertedCurrency" TEXT,
    "conversionStatus" TEXT NOT NULL,
    "fxEvidence" JSONB,
    "observationSequence" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonFinanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonFinanceQuarantine" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonFinanceQuarantine_pkey" PRIMARY KEY ("recordId")
);

-- CreateIndex
CREATE INDEX "AmazonFinance_scope_posted_idx" ON "AmazonFinanceRecord"("organizationId", "workspaceId", "sellerAccountId", "marketplaceId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFinance_business_key" ON "AmazonFinanceRecord"("organizationId", "workspaceId", "amazonSellerId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFinance_scope_id_key" ON "AmazonFinanceRecord"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFinanceQuarantine_scope_key" ON "AmazonFinanceQuarantine"("organizationId", "workspaceId", "recordId");

-- AddForeignKey
ALTER TABLE "AmazonFinanceRecord" ADD CONSTRAINT "AmazonFinance_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonFinanceRecord" ADD CONSTRAINT "AmazonFinance_run_fkey" FOREIGN KEY ("sourceRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonFinanceQuarantine" ADD CONSTRAINT "AmazonFinanceQuarantine_record_fkey" FOREIGN KEY ("organizationId", "workspaceId", "recordId") REFERENCES "AmazonFinanceRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One seller-wide source per verified authorization/region. Existing site-scoped
-- sources and their uniqueness constraints retain their original meaning.
CREATE UNIQUE INDEX "AmazonFinance_source_authorization_key" ON "AmazonSyncDataSource" ("organizationId","workspaceId","authorizationId") WHERE "resource" = 'finance';
ALTER TABLE "AmazonFinanceRecord" ADD CONSTRAINT "AmazonFinance_attribution_shape" CHECK (
 ("attributionStatus" = 'ATTRIBUTED' AND "marketplaceId" IS NOT NULL AND "marketplaceTimeZone" IS NOT NULL AND "quarantineReason" IS NULL AND "originalAmount" IS NOT NULL AND "amount" IS NOT NULL AND "currency" IS NOT NULL)
 OR ("attributionStatus" = 'QUARANTINED' AND "marketplaceId" IS NULL AND "marketplaceTimeZone" IS NULL AND "quarantineReason" IS NOT NULL AND "originalAmount" IS NULL AND "amount" IS NULL AND "currency" IS NULL AND "orderId" IS NULL AND "convertedAmount" IS NULL AND "fxEvidence" IS NULL));
ALTER TABLE "AmazonFinanceRecord" ADD CONSTRAINT "AmazonFinance_conversion_shape" CHECK (
 ("conversionStatus" = 'CONVERTED' AND "convertedAmount" IS NOT NULL AND "convertedCurrency" IS NOT NULL AND "fxEvidence" IS NOT NULL)
 OR ("conversionStatus" IN ('UNCONVERTED','QUARANTINED') AND "convertedAmount" IS NULL AND "fxEvidence" IS NULL));
ALTER TABLE "AmazonFinanceRecord" ADD CONSTRAINT "AmazonFinance_sequence" CHECK ("observationSequence" > 0);
ALTER TABLE "AmazonSyncResourceCursor" ADD CONSTRAINT "AmazonCursor_capture_sequence" CHECK ("captureSequence" >= 0);

CREATE INDEX "AmazonFinance_source_posted_idx" ON "AmazonFinanceRecord" ("organizationId","workspaceId","sourceId","attributionStatus","postedAt");
