-- 积分额度系统
-- 只新增 8 张表、索引与 CHECK 约束，不改动任何既有表。
-- 规则：每人每月基础额度 50；结转上限 50；审批补充额当月有效、不结转。

-- CreateTable
CREATE TABLE "PointsPolicy" (
    "organizationId" TEXT NOT NULL,
    "baseQuota" INTEGER NOT NULL DEFAULT 50,
    "carryoverCap" INTEGER NOT NULL DEFAULT 50,
    "maxRequestsPerPeriod" INTEGER NOT NULL DEFAULT 3,
    "maxRequestAmount" INTEGER NOT NULL DEFAULT 200,
    "maxExtraPerPeriod" INTEGER NOT NULL DEFAULT 300,
    "requestExpireDays" INTEGER NOT NULL DEFAULT 7,
    "reserveTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "warnPercent" INTEGER NOT NULL DEFAULT 20,
    "grantOnCreate" BOOLEAN NOT NULL DEFAULT true,
    "grantToDisabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsPolicy_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PointsPriceRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operationCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "unitCost" INTEGER NOT NULL,
    "maxCost" INTEGER NOT NULL,
    "dailyFreeCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsAccount" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lastPeriod" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsAccount_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "PointsGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "carryable" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceRequestId" TEXT,
    "sourceRunId" TEXT,
    "reason" TEXT,
    "operatorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "operationCode" TEXT,
    "delta" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "balanceAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL DEFAULT 0,
    "grantId" TEXT,
    "priceRuleVersion" INTEGER,
    "unitCost" INTEGER,
    "runId" TEXT,
    "requestId" TEXT,
    "note" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsPeriod" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "baseQuota" INTEGER NOT NULL DEFAULT 0,
    "carriedIn" INTEGER NOT NULL DEFAULT 0,
    "extraGranted" INTEGER NOT NULL DEFAULT 0,
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "expiredAmount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PointsPeriod_pkey" PRIMARY KEY ("organizationId","userId","period")
);

-- CreateTable
CREATE TABLE "PointsRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL,
    "approvedAmount" INTEGER,
    "reason" TEXT NOT NULL,
    "usagePlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "grantId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsMemberOverride" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyQuota" INTEGER,
    "carryoverCap" INTEGER,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canRequest" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsMemberOverride_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointsPriceRule_organizationId_operationCode_version_key" ON "PointsPriceRule"("organizationId", "operationCode", "version");
CREATE INDEX "PointsPriceRule_organizationId_operationCode_status_effectiveFrom_idx" ON "PointsPriceRule"("organizationId", "operationCode", "status", "effectiveFrom");
CREATE INDEX "PointsAccount_organizationId_balance_idx" ON "PointsAccount"("organizationId", "balance");
CREATE UNIQUE INDEX "PointsGrant_sourceRequestId_key" ON "PointsGrant"("sourceRequestId");
CREATE INDEX "PointsGrant_organizationId_userId_status_expiresAt_idx" ON "PointsGrant"("organizationId", "userId", "status", "expiresAt");
CREATE INDEX "PointsGrant_organizationId_period_kind_idx" ON "PointsGrant"("organizationId", "period", "kind");
CREATE UNIQUE INDEX "PointsLedger_organizationId_userId_requestKey_kind_key" ON "PointsLedger"("organizationId", "userId", "requestKey", "kind");
CREATE INDEX "PointsLedger_organizationId_userId_createdAt_id_idx" ON "PointsLedger"("organizationId", "userId", "createdAt", "id");
CREATE INDEX "PointsLedger_organizationId_status_createdAt_idx" ON "PointsLedger"("organizationId", "status", "createdAt");
CREATE INDEX "PointsPeriod_organizationId_period_status_idx" ON "PointsPeriod"("organizationId", "period", "status");
CREATE UNIQUE INDEX "PointsRequest_organizationId_requestNo_key" ON "PointsRequest"("organizationId", "requestNo");
CREATE INDEX "PointsRequest_organizationId_status_createdAt_idx" ON "PointsRequest"("organizationId", "status", "createdAt");
CREATE INDEX "PointsRequest_organizationId_applicantId_period_status_idx" ON "PointsRequest"("organizationId", "applicantId", "period", "status");

-- 冻结流水的部分索引：未结算的 RESERVE 极少，避免全表扫描
CREATE INDEX "PointsLedger_held_idx" ON "PointsLedger"("organizationId", "createdAt") WHERE "status" = 'HELD';

-- AddForeignKey
ALTER TABLE "PointsPolicy" ADD CONSTRAINT "PointsPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsPriceRule" ADD CONSTRAINT "PointsPriceRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsGrant" ADD CONSTRAINT "PointsGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsGrant" ADD CONSTRAINT "PointsGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsPeriod" ADD CONSTRAINT "PointsPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsPeriod" ADD CONSTRAINT "PointsPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsRequest" ADD CONSTRAINT "PointsRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsMemberOverride" ADD CONSTRAINT "PointsMemberOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsMemberOverride" ADD CONSTRAINT "PointsMemberOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 规则约束：写进数据库，不依赖应用层自觉
ALTER TABLE "PointsRequest" ADD CONSTRAINT "chk_points_no_self_approval"
  CHECK ("approverId" IS NULL OR "approverId" <> "applicantId");
ALTER TABLE "PointsRequest" ADD CONSTRAINT "chk_points_request_amount"
  CHECK ("requestedAmount" > 0 AND ("approvedAmount" IS NULL OR "approvedAmount" > 0));
ALTER TABLE "PointsRequest" ADD CONSTRAINT "chk_points_request_status"
  CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','EXPIRED'));

ALTER TABLE "PointsGrant" ADD CONSTRAINT "chk_points_grant_nonneg"
  CHECK ("amount" > 0 AND "remaining" >= 0 AND "reserved" >= 0 AND "reserved" <= "remaining");
ALTER TABLE "PointsGrant" ADD CONSTRAINT "chk_points_grant_kind"
  CHECK ("kind" IN ('BASE','CARRIED','EXTRA','ADJUST'));
ALTER TABLE "PointsGrant" ADD CONSTRAINT "chk_points_grant_carryable"
  CHECK ("carryable" = false OR "kind" = 'BASE');

ALTER TABLE "PointsAccount" ADD CONSTRAINT "chk_points_account_nonneg"
  CHECK ("balance" >= 0 AND "reserved" >= 0);
ALTER TABLE "PointsPeriod" ADD CONSTRAINT "chk_points_period_status"
  CHECK ("status" IN ('OPEN','CLOSING','CLOSED'));
ALTER TABLE "PointsPriceRule" ADD CONSTRAINT "chk_points_price_cost"
  CHECK ("unitCost" >= 0 AND "maxCost" >= "unitCost");
ALTER TABLE "PointsLedger" ADD CONSTRAINT "chk_points_ledger_kind"
  CHECK ("kind" IN ('GRANT','RESERVE','SETTLE','RELEASE','OVERSHOOT','EXPIRE','ADJUST'));
