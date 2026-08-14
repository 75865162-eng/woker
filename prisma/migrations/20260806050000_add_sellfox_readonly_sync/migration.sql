CREATE TABLE "SellfoxStore" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "marketplace" TEXT NOT NULL DEFAULT '',
  "country" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "payload" JSONB NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellfoxHourlyMetric" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "storeId" TEXT NOT NULL,
  "reportDate" TEXT NOT NULL,
  "hour" INTEGER NOT NULL,
  "adType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityName" TEXT NOT NULL DEFAULT '',
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orders" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellfoxHourlyMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellfoxSyncRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "resource" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "summary" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "SellfoxSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxStore_organizationId_workspaceId_externalId_key" ON "SellfoxStore"("organizationId", "workspaceId", "externalId");
CREATE INDEX "SellfoxStore_organizationId_workspaceId_updatedAt_idx" ON "SellfoxStore"("organizationId", "workspaceId", "updatedAt");
CREATE UNIQUE INDEX "SellfoxHourlyMetric_storeId_reportDate_hour_adType_entityType_entityId_key" ON "SellfoxHourlyMetric"("storeId", "reportDate", "hour", "adType", "entityType", "entityId");
CREATE INDEX "SellfoxHourlyMetric_organizationId_workspaceId_reportDate_idx" ON "SellfoxHourlyMetric"("organizationId", "workspaceId", "reportDate");
CREATE INDEX "SellfoxSyncRun_organizationId_workspaceId_startedAt_idx" ON "SellfoxSyncRun"("organizationId", "workspaceId", "startedAt");
ALTER TABLE "SellfoxHourlyMetric" ADD CONSTRAINT "SellfoxHourlyMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "SellfoxStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
