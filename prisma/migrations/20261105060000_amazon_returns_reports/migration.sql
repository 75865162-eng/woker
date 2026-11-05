-- P4 additive Reports 2021-06-30 returns schema. No backfill or live activation.
-- Keep legacy mode constraints intact and extend only the new resource branch.
ALTER TABLE "AmazonSyncDataSource" DROP CONSTRAINT "AmazonSource_domain_policy";
ALTER TABLE "AmazonSyncDataSource" ADD CONSTRAINT "AmazonSource_domain_policy" CHECK (
  "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns') AND "freshnessMinutes" BETWEEN 15 AND 43200 AND "rowCount" >= 0);

ALTER TABLE "AmazonSyncRun" DROP CONSTRAINT "AmazonSyncRun_v2_shape";
ALTER TABLE "AmazonSyncRun" ADD CONSTRAINT "AmazonSyncRun_v2_shape" CHECK (
  "executionVersion" <> 2 OR ("sourceId" IS NOT NULL AND "resource" IN ('inventory','catalog','sales_traffic','orders','finance','returns')
  AND (("resource" = 'sales_traffic' AND "mode" = 'date_range') OR ("resource" IN ('inventory','catalog') AND "mode" = 'snapshot') OR ("resource" IN ('orders','finance','returns') AND "mode" = 'incremental'))
  AND "attempts" >= 0 AND "maxAttempts" >= 1 AND "pagesCompleted" >= 0
  AND "processedCount" >= 0 AND "insertedCount" >= 0 AND "skippedCount" >= 0
  AND "status" IN ('WAITING','QUEUED','RUNNING','RETRY_WAIT','PAUSED','SUCCEEDED','PARTIAL_SUCCESS','FAILED','CANCELLED','BLOCKED')));
-- AlterTable
ALTER TABLE "AmazonSyncDataSource" ADD COLUMN     "returnsPolicy" JSONB;

-- AlterTable
ALTER TABLE "AmazonSyncResourceCursor" ADD COLUMN     "reportStateCiphertext" TEXT;

-- CreateTable
CREATE TABLE "AmazonReturnReason" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "AmazonReturnReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonReturnRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "amazonSellerId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "marketplaceTimeZone" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,
    "returnAt" TIMESTAMPTZ(3) NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "fnsku" TEXT,
    "quantity" INTEGER NOT NULL,
    "fulfillmentCenterId" TEXT,
    "disposition" TEXT,
    "reasonId" TEXT,
    "rawStatus" TEXT,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AmazonReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonReturnReason_code_key" ON "AmazonReturnReason"("organizationId", "workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonReturnReason_scope_key" ON "AmazonReturnReason"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE INDEX "AmazonReturn_report_idx" ON "AmazonReturnRecord"("organizationId", "workspaceId", "sourceId", "reportId", "returnAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonReturn_business_key" ON "AmazonReturnRecord"("organizationId", "workspaceId", "amazonSellerId", "marketplaceId", "reportId", "rowHash");

-- AddForeignKey
ALTER TABLE "AmazonReturnRecord" ADD CONSTRAINT "AmazonReturn_source_fkey" FOREIGN KEY ("organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncDataSource"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonReturnRecord" ADD CONSTRAINT "AmazonReturn_run_fkey" FOREIGN KEY ("sourceRunId", "organizationId", "workspaceId", "sourceId") REFERENCES "AmazonSyncRun"("id", "organizationId", "workspaceId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonReturnRecord" ADD CONSTRAINT "AmazonReturn_reason_fkey" FOREIGN KEY ("organizationId", "workspaceId", "reasonId") REFERENCES "AmazonReturnReason"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AmazonReturnRecord" ADD CONSTRAINT "AmazonReturn_quantity" CHECK ("quantity" > 0);
