-- 积分预扣分配明细
-- 一次预扣可能跨多个批次（BASE / CARRIED / EXTRA），结算与释放必须逐批次回滚，
-- 因此把「哪个 requestKey 占了哪个批次的多少分」单独记录。
-- 只新增一张表，不改动上一批积分表。

CREATE TABLE "PointsAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "settledAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PointsAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointsAllocation_organizationId_userId_requestKey_grantId_key" ON "PointsAllocation"("organizationId", "userId", "requestKey", "grantId");
CREATE INDEX "PointsAllocation_organizationId_grantId_status_idx" ON "PointsAllocation"("organizationId", "grantId", "status");
CREATE INDEX "PointsAllocation_organizationId_requestKey_status_idx" ON "PointsAllocation"("organizationId", "requestKey", "status");

ALTER TABLE "PointsAllocation" ADD CONSTRAINT "PointsAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointsAllocation" ADD CONSTRAINT "PointsAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointsAllocation" ADD CONSTRAINT "chk_points_allocation_amount"
  CHECK ("amount" > 0 AND "settledAmount" >= 0 AND "settledAmount" <= "amount");
ALTER TABLE "PointsAllocation" ADD CONSTRAINT "chk_points_allocation_status"
  CHECK ("status" IN ('HELD','SETTLED','RELEASED'));
