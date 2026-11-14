-- 库存 × 广告联动优化方案（看板待审批 → 批准 → 写回草稿）。
-- 纯新增读模型表，不改动既有 Sellfox 表结构；storeId 走外键保证店铺归属。

CREATE TABLE "SellfoxAdsProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "msku" TEXT,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "label" TEXT,
    "current" JSONB,
    "proposed" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "expectedImpact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "decisionReason" TEXT,
    "changeDraftId" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxAdsProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxAdsProposal_key" ON "SellfoxAdsProposal"("organizationId", "workspaceId", "externalId", "kind");

CREATE INDEX "SellfoxAdsProposal_scope_status" ON "SellfoxAdsProposal"("organizationId", "workspaceId", "status", "createdAt");

ALTER TABLE "SellfoxAdsProposal" ADD CONSTRAINT "SellfoxAdsProposal_store_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
