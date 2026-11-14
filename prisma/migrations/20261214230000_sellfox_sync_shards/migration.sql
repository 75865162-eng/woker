-- 同步分片断点 + 泛化覆盖度表。
-- SellfoxSyncShard：run 按「资源 × 店铺(scopeKey) × 期间(period)」记录进度与断点（cursor），
--   重跑覆盖同一分片时按唯一键 upsert，不做历史累积。
-- SellfoxCoverage：每次 run 完成后按「资源 × 店铺」从事实表重新计算 min/max 日期与行数，
--   不是累加写入数，保证与落表数据一致。纯新增表，不改动既有结构。

CREATE TABLE "SellfoxSyncShard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "resource" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "cursor" JSONB,
    "runId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SellfoxSyncShard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxSyncShard_organizationId_workspaceId_resource_scopeKey_period_key" ON "SellfoxSyncShard"("organizationId", "workspaceId", "resource", "scopeKey", "period");
CREATE INDEX "SellfoxSyncShard_organizationId_workspaceId_resource_updatedAt_idx" ON "SellfoxSyncShard"("organizationId", "workspaceId", "resource", "updatedAt");
CREATE INDEX "SellfoxSyncShard_resource_status_idx" ON "SellfoxSyncShard"("resource", "status");

CREATE TABLE "SellfoxCoverage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'default',
    "resource" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "firstDate" TEXT,
    "lastDate" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunId" TEXT,
    "lastStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxCoverage_organizationId_workspaceId_resource_storeId_key" ON "SellfoxCoverage"("organizationId", "workspaceId", "resource", "storeId");
CREATE INDEX "SellfoxCoverage_organizationId_workspaceId_resource_idx" ON "SellfoxCoverage"("organizationId", "workspaceId", "resource");
