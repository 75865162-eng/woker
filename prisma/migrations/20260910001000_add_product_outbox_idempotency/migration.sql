ALTER TABLE "AuditLog"
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "DataChangeVersion"
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "UserNotification"
  ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "AuditLog_idempotencyKey_key"
  ON "AuditLog"("idempotencyKey");

CREATE UNIQUE INDEX "DataChangeVersion_idempotencyKey_key"
  ON "DataChangeVersion"("idempotencyKey");

CREATE UNIQUE INDEX "UserNotification_dedupeKey_key"
  ON "UserNotification"("dedupeKey");
