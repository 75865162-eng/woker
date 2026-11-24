-- Additive only. 2026-11-24 系统管理 + 采购物流升级。
-- 系统管理：部门 / 公告 / 个人记事本（对标 wimoor sys 域，排除亚马逊）。
-- 采购物流：物流渠道 / 关联设置 / 询价单 / 报价单 / 采购退货单（对标 wimoor-quote + 采购变更）。
-- 全表组织+工作区双围栏；金额为 Decimal(20,6)；无外部写、无第三方事实源覆盖。

-- 部门
CREATE TABLE IF NOT EXISTS "Department" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "leader" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Department_code_key" ON "Department" ("organizationId", "workspaceId", "code");
CREATE INDEX IF NOT EXISTS "Department_parent_idx" ON "Department" ("organizationId", "workspaceId", "parentId", "sortOrder");

-- 公告
CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "audience" TEXT NOT NULL DEFAULT 'ALL',
  "audienceValue" TEXT NOT NULL DEFAULT '',
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Announcement_status_idx" ON "Announcement" ("organizationId", "workspaceId", "status", "publishedAt");

-- 个人记事本
CREATE TABLE IF NOT EXISTS "PersonalNote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT '',
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonalNote_user_idx" ON "PersonalNote" ("organizationId", "workspaceId", "userId", "pinned", "updatedAt");

-- 物流渠道
CREATE TABLE IF NOT EXISTS "LogisticsQuoteChannel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'SEA',
  "destination" TEXT NOT NULL DEFAULT '',
  "pricingRule" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsQuoteChannel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsQuoteChannel_code_key" ON "LogisticsQuoteChannel" ("organizationId", "workspaceId", "code");
-- 复合外键 (organizationId, workspaceId, id) 需要匹配的唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsQuoteChannel_scope_id_key" ON "LogisticsQuoteChannel" ("organizationId", "workspaceId", "id");
CREATE INDEX IF NOT EXISTS "LogisticsQuoteChannel_mode_idx" ON "LogisticsQuoteChannel" ("organizationId", "workspaceId", "mode", "enabled");

-- 关联设置
CREATE TABLE IF NOT EXISTS "LogisticsQuoteRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "channelId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL DEFAULT '',
  "matchType" TEXT NOT NULL DEFAULT 'SKU',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsQuoteRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LogisticsQuoteRule_channel_fkey" FOREIGN KEY ("organizationId", "workspaceId", "channelId") REFERENCES "LogisticsQuoteChannel" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LogisticsQuoteRule_channel_idx" ON "LogisticsQuoteRule" ("organizationId", "workspaceId", "channelId", "priority");

-- 询价单
CREATE TABLE IF NOT EXISTS "LogisticsQuoteRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "origin" TEXT NOT NULL DEFAULT '',
  "destination" TEXT NOT NULL DEFAULT '',
  "preferredMode" TEXT NOT NULL DEFAULT '',
  "pieces" INTEGER NOT NULL DEFAULT 0,
  "weightKg" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "volumeCbm" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "needBy" DATE,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsQuoteRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsQuoteRequest_number_key" ON "LogisticsQuoteRequest" ("organizationId", "workspaceId", "number");
CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsQuoteRequest_scope_id_key" ON "LogisticsQuoteRequest" ("organizationId", "workspaceId", "id");
CREATE INDEX IF NOT EXISTS "LogisticsQuoteRequest_status_idx" ON "LogisticsQuoteRequest" ("organizationId", "workspaceId", "status", "createdAt");

-- 报价单
CREATE TABLE IF NOT EXISTS "LogisticsQuote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "channelId" TEXT,
  "carrier" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "transitDays" INTEGER NOT NULL DEFAULT 0,
  "validUntil" DATE,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LogisticsQuote_request_fkey" FOREIGN KEY ("organizationId", "workspaceId", "requestId") REFERENCES "LogisticsQuoteRequest" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LogisticsQuote_channel_fkey" FOREIGN KEY ("organizationId", "workspaceId", "channelId") REFERENCES "LogisticsQuoteChannel" ("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsQuote_number_key" ON "LogisticsQuote" ("organizationId", "workspaceId", "number");
CREATE INDEX IF NOT EXISTS "LogisticsQuote_request_idx" ON "LogisticsQuote" ("organizationId", "workspaceId", "requestId", "status");

-- 采购退货单
CREATE TABLE IF NOT EXISTS "PurchaseReturn" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL DEFAULT '',
  "purchaseOrderId" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "lines" JSONB,
  "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requestHash" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturn_number_key" ON "PurchaseReturn" ("organizationId", "workspaceId", "number");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_status_idx" ON "PurchaseReturn" ("organizationId", "workspaceId", "status", "createdAt");

-- 组织/工作区外键（沿用现有双围栏）
ALTER TABLE "Department" ADD CONSTRAINT "Department_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteChannel" ADD CONSTRAINT "LogisticsQuoteChannel_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteChannel" ADD CONSTRAINT "LogisticsQuoteChannel_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteRule" ADD CONSTRAINT "LogisticsQuoteRule_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteRule" ADD CONSTRAINT "LogisticsQuoteRule_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteRequest" ADD CONSTRAINT "LogisticsQuoteRequest_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuoteRequest" ADD CONSTRAINT "LogisticsQuoteRequest_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuote" ADD CONSTRAINT "LogisticsQuote_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsQuote" ADD CONSTRAINT "LogisticsQuote_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope" ("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
