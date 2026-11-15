-- 本地可闭环三项：FBA 内部标签、在途调拨签收差异、Amazon 结算 SKU 分摊。
-- 纯 additive：只 CREATE TABLE / ADD COLUMN（带 DEFAULT）/ 新对象上的索引与 CHECK。
-- 不重写既有迁移、不回填历史行、不新增调拨状态值、不改动任何既有列或约束。

-- 1. 本地 FBA 内部标签（非 Amazon 官方箱唛）
CREATE TABLE "FbaLocalShipmentLabel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FbaLocalShipmentLabel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FbaLocalShipmentLabel_kind_check" CHECK ("kind" IN ('BOX_LABEL','ITEM_LABEL'))
);

CREATE UNIQUE INDEX "FbaLocalShipmentLabel_request_key"
    ON "FbaLocalShipmentLabel"("organizationId", "workspaceId", "planId", "idempotencyKey");
CREATE INDEX "FbaLocalShipmentLabel_scope_date_idx"
    ON "FbaLocalShipmentLabel"("organizationId", "workspaceId", "planId", "createdAt", "id");

-- 2. 在途调拨签收差异
CREATE TABLE "WmsTransferDiscrepancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "claimReference" TEXT,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionEvidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsTransferDiscrepancy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WmsTransferDiscrepancy_value_check" CHECK (
        "category" IN ('SHORT_RECEIVED','DAMAGED','REJECTED')
        AND "quantity" > 0
        AND "status" IN ('DRAFT','REVIEWED','REJECTED','CLAIMED')
        AND ("reviewedBy" IS NULL OR "reviewedBy" <> "createdBy")
    )
);

CREATE UNIQUE INDEX "WmsTransferDiscrepancy_request_key"
    ON "WmsTransferDiscrepancy"("organizationId", "workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "WmsTransferDiscrepancy_line_category_key"
    ON "WmsTransferDiscrepancy"("organizationId", "workspaceId", "lineId", "category");
CREATE INDEX "WmsTransferDiscrepancy_scope_status_idx"
    ON "WmsTransferDiscrepancy"("organizationId", "workspaceId", "orderId", "status");

-- 差异量只是对在途量的重分类，不改动 shippedQty/receivedQty，也不生成库存流水。
ALTER TABLE "WmsTransferOrderLine"
    ADD COLUMN "discrepancyQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WmsTransferOrderLine"
    ADD CONSTRAINT "WmsTransferOrderLine_discrepancy_check"
    CHECK ("discrepancyQty" >= 0 AND "discrepancyQty" <= "shippedQty" - "receivedQty");

-- 3. Amazon 结算 SKU 分摊批次与明细
CREATE TABLE "AmazonSettlementAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "settlementReportId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "basisType" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "remainderPolicy" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reconciliation" JSONB NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "openItemId" TEXT,
    "settlementRef" TEXT,
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalEvidence" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSettlementAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AmazonSettlementAllocation_value_check" CHECK (
        "basisType" IN ('PRINCIPAL','SALES','NONE')
        AND "remainderPolicy" IN ('LARGEST_REMAINDER','MAX_PRINCIPAL_SKU')
        AND "status" IN ('STAGED','PUBLISHED','REVERSED')
    )
);

CREATE UNIQUE INDEX "AmazonSettlementAllocation_batch_key"
    ON "AmazonSettlementAllocation"("organizationId", "workspaceId", "settlementReportId", "algorithmVersion", "inputDigest");
CREATE UNIQUE INDEX "AmazonSettlementAllocation_request_key"
    ON "AmazonSettlementAllocation"("organizationId", "workspaceId", "idempotencyKey");
CREATE INDEX "AmazonSettlementAllocation_scope_status_idx"
    ON "AmazonSettlementAllocation"("organizationId", "workspaceId", "settlementId", "status");

CREATE TABLE "AmazonSettlementAllocationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sellerSku" TEXT,
    "businessDate" VARCHAR(10),
    "currency" TEXT NOT NULL,
    "basisAmount" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "shareStorageFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareLongStorageFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareAdvSpendFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareCouponRedemptionFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareReserveFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareReimbursementFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareDisposalFee" TEXT NOT NULL DEFAULT '0.000000',
    "shareShopOtherFee" TEXT NOT NULL DEFAULT '0.000000',
    "isRemainderBearer" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT NOT NULL,
    "overlapKey" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "principalRowRefs" JSONB NOT NULL,
    "feeRowRefs" JSONB NOT NULL,
    "suppressedRowNumbers" JSONB NOT NULL,
    "dedupeEvidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSettlementAllocationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonSettlementAllocationLine_sku_key"
    ON "AmazonSettlementAllocationLine"("allocationId", "sku", "businessDate");
CREATE INDEX "AmazonSettlementAllocationLine_dedupe_idx"
    ON "AmazonSettlementAllocationLine"("organizationId", "workspaceId", "dedupeKey");
CREATE INDEX "AmazonSettlementAllocationLine_overlap_idx"
    ON "AmazonSettlementAllocationLine"("organizationId", "workspaceId", "overlapKey");
