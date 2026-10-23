CREATE TABLE "AmazonSyncSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "resource" TEXT NOT NULL,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 60 CHECK ("intervalMinutes" BETWEEN 15 AND 10080),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastEnqueuedAt" TIMESTAMP(3),
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonSchedule_supported_enabled" CHECK (NOT "enabled" OR "resource" = 'inventory')
);
CREATE UNIQUE INDEX "AmazonSchedule_scope_resource_key" ON "AmazonSyncSchedule" ("organizationId", "workspaceId", "resource");
CREATE INDEX "AmazonSchedule_due_idx" ON "AmazonSyncSchedule" ("enabled", "lastEnqueuedAt");
