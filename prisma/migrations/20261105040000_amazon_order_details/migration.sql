-- P2 additive schema, Orders v2026-01-01 only. No backfill/live activation.
ALTER TABLE "AmazonSyncRun" ADD COLUMN "detailsCompletedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AmazonSyncResourceCursor" ADD COLUMN "listComplete" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "detailPolicyDigest" TEXT;
ALTER TABLE "AmazonOrderRecord" ADD COLUMN "detailsUpdatedAt" TIMESTAMPTZ(3),
    ADD COLUMN "detailPolicyDigest" TEXT, ADD COLUMN "detailHash" TEXT,
    ADD COLUMN "detailCiphertext" TEXT, ADD COLUMN "grandTotalOriginal" TEXT,
    ADD COLUMN "grandTotalAmount" DECIMAL(65,30), ADD COLUMN "currencyCode" TEXT;
CREATE UNIQUE INDEX "AmazonOrder_scope_record_key" ON "AmazonOrderRecord"("organizationId","workspaceId","sourceId","id");

CREATE TABLE "AmazonOrderItemRecord" (
    "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL, "orderRecordId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL, "asin" TEXT, "sellerSku" TEXT,
    "quantityOrdered" INTEGER NOT NULL, "proceedsOriginal" TEXT,
    "proceedsAmount" DECIMAL(65,30), "currencyCode" TEXT,
    CONSTRAINT "AmazonOrderItemRecord_pkey" PRIMARY KEY ("orderRecordId","orderItemId"),
    CONSTRAINT "AmazonOrderItemRecord_order_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceId","orderRecordId") REFERENCES "AmazonOrderRecord"("organizationId","workspaceId","sourceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AmazonOrderItem_quantity" CHECK ("quantityOrdered" >= 0),
    CONSTRAINT "AmazonOrderItem_money" CHECK (("proceedsOriginal" IS NULL AND "proceedsAmount" IS NULL AND "currencyCode" IS NULL) OR ("proceedsOriginal" IS NOT NULL AND "proceedsAmount" IS NOT NULL AND "currencyCode" IS NOT NULL AND "proceedsOriginal"::numeric = "proceedsAmount"))
);
CREATE INDEX "AmazonOrderItem_scope_asin_idx" ON "AmazonOrderItemRecord"("organizationId","workspaceId","sourceId","asin");
CREATE TABLE "AmazonOrderDetailWork" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL, "amazonOrderId" TEXT NOT NULL,
    "listedUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "watermarkFrom" TIMESTAMPTZ(3) NOT NULL, "watermarkTo" TIMESTAMPTZ(3) NOT NULL,
    "policyDigest" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "AmazonOrderDetailWork_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AmazonOrderDetailWork_order_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceId","orderRecordId") REFERENCES "AmazonOrderRecord"("organizationId","workspaceId","sourceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AmazonOrderDetail_status" CHECK ("status" IN ('PENDING','SUCCEEDED'))
);
CREATE UNIQUE INDEX "AmazonOrderDetail_business_key" ON "AmazonOrderDetailWork"("sourceId","amazonOrderId","listedUpdatedAt","policyDigest");
CREATE INDEX "AmazonOrderDetail_pending_idx" ON "AmazonOrderDetailWork"("organizationId","workspaceId","sourceId","status","watermarkFrom","watermarkTo");
ALTER TABLE "AmazonOrderRecord" ADD CONSTRAINT "AmazonOrder_money" CHECK (
    ("grandTotalOriginal" IS NULL AND "grandTotalAmount" IS NULL AND "currencyCode" IS NULL) OR
    ("grandTotalOriginal" IS NOT NULL AND "grandTotalAmount" IS NOT NULL AND "currencyCode" IS NOT NULL AND "grandTotalOriginal"::numeric = "grandTotalAmount"));
