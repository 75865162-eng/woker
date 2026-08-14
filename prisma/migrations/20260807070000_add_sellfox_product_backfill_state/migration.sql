CREATE TABLE "SellfoxProductBackfillState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "nextReportDate" TEXT NOT NULL,
  "emptyDayStreak" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'running',
  "lastError" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxProductBackfillState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellfoxProductBackfillState_organizationId_workspaceId_key" ON "SellfoxProductBackfillState"("organizationId", "workspaceId");
CREATE INDEX "SellfoxProductBackfillState_status_updatedAt_idx" ON "SellfoxProductBackfillState"("status", "updatedAt");
