-- WIMOOR 页面功能迁移：通用主数据条目
CREATE TABLE IF NOT EXISTS "MasterDataEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "code" VARCHAR(128) NOT NULL,
  "name" VARCHAR(256) NOT NULL,
  "parentCode" VARCHAR(128),
  "color" VARCHAR(32),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "MasterDataEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MasterDataEntry_key" ON "MasterDataEntry"("organizationId", "workspaceId", "kind", "code");
CREATE INDEX IF NOT EXISTS "MasterDataEntry_kind_idx" ON "MasterDataEntry"("organizationId", "workspaceId", "kind", "parentCode");

-- WIMOOR 页面功能迁移：通用业务单据
CREATE TABLE IF NOT EXISTS "MasterDataDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "docNo" VARCHAR(128) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "partnerCode" VARCHAR(128),
  "businessDate" VARCHAR(10),
  "amount" DECIMAL(30,6),
  "currency" VARCHAR(3),
  "remark" VARCHAR(1024),
  "payload" JSONB,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "MasterDataDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MasterDataDocument_key" ON "MasterDataDocument"("organizationId", "workspaceId", "kind", "docNo");
CREATE INDEX IF NOT EXISTS "MasterDataDocument_kind_idx" ON "MasterDataDocument"("organizationId", "workspaceId", "kind", "status");
