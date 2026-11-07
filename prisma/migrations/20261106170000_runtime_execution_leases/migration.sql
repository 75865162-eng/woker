-- Additive only. Legacy running rows retain NULL ownership and are not auto-replayed.
ALTER TABLE "ImportJob"
 ADD COLUMN "executionToken" TEXT,
 ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
 ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ImageUpscaleJob"
 ADD COLUMN "executionToken" TEXT,
 ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
 ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;
CREATE INDEX "ImportJob_status_leaseExpiresAt_idx" ON "ImportJob"(status, "leaseExpiresAt");
CREATE INDEX "ImageUpscaleJob_status_leaseExpiresAt_idx" ON "ImageUpscaleJob"(status, "leaseExpiresAt");
