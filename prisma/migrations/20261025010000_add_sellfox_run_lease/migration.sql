-- Additive execution ownership only. Snapshot/history tables remain unchanged.
ALTER TABLE "SellfoxSyncRun"
ADD COLUMN "executionToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "SellfoxSyncRun_status_leaseExpiresAt_idx" ON "SellfoxSyncRun"("status", "leaseExpiresAt");
