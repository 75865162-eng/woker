CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserNotification_organizationId_createdAt_idx" ON "UserNotification"("organizationId", "createdAt");
CREATE INDEX "UserNotification_organizationId_recipientUserId_createdAt_idx" ON "UserNotification"("organizationId", "recipientUserId", "createdAt");
CREATE INDEX "UserNotification_organizationId_recipientUserId_readAt_createdAt_idx" ON "UserNotification"("organizationId", "recipientUserId", "readAt", "createdAt");
CREATE INDEX "UserNotification_entityType_entityId_idx" ON "UserNotification"("entityType", "entityId");

ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
