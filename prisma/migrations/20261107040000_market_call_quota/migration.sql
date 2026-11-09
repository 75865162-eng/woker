CREATE TABLE "MarketCallAccount" (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketCallAccount_pkey" PRIMARY KEY ("organizationId", "userId"),
  CONSTRAINT "MarketCallAccount_member_fkey" FOREIGN KEY ("organizationId", "userId")
    REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "MarketCallEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('CALL','ADJUSTMENT')),
  "delta" INTEGER NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('RESERVED','COMPLETED','FAILED','UNKNOWN','REFUNDED')),
  "balanceAfter" INTEGER NOT NULL CHECK ("balanceAfter" >= 0),
  "provider" TEXT,
  "tool" TEXT,
  "workspaceId" TEXT,
  "runId" TEXT,
  "callId" TEXT,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketCallEntry_account_fkey" FOREIGN KEY ("organizationId", "userId")
    REFERENCES "MarketCallAccount"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MarketCallEntry_call_check" CHECK (
    ("kind"='CALL' AND "provider" IN ('sellersprite','xiyou') AND "provider" IS NOT NULL
      AND "callId" IS NOT NULL AND "tool" IS NOT NULL AND "runId" IS NOT NULL AND "workspaceId" IS NOT NULL
      AND (("status"='REFUNDED' AND "delta"=0) OR ("status"<>'REFUNDED' AND "delta"=-1)))
    OR ("kind"='ADJUSTMENT' AND "status"='COMPLETED' AND "provider" IS NULL AND "callId" IS NULL))
);
CREATE UNIQUE INDEX "MarketCallEntry_organizationId_userId_requestKey_key" ON "MarketCallEntry"("organizationId","userId","requestKey");
CREATE INDEX "MarketCallEntry_organizationId_userId_createdAt_id_idx" ON "MarketCallEntry"("organizationId","userId","createdAt","id");
