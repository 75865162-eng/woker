-- 后台配置的赛狐 API 端点 + 通用原始行落地表。
-- 新增接口不需要建业务表：配置一条端点，编排器自动按规则拉全量。

CREATE TABLE "SellfoxApiEndpoint" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "dateMode" TEXT NOT NULL DEFAULT 'range',
  "scopeMode" TEXT NOT NULL DEFAULT 'store',
  "chunkDays" INTEGER NOT NULL DEFAULT 7,
  "pageSize" INTEGER NOT NULL DEFAULT 100,
  "rowsPath" TEXT NOT NULL DEFAULT '',
  "idFields" TEXT NOT NULL DEFAULT '',
  "params" TEXT NOT NULL DEFAULT '{}',
  "maxRows" INTEGER NOT NULL DEFAULT 50000,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "historyFrom" TEXT,
  "cursorDate" TEXT,
  "lastPlannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellfoxApiEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxApiEndpoint_organizationId_workspaceId_code_key"
  ON "SellfoxApiEndpoint"("organizationId", "workspaceId", "code");
CREATE INDEX "SellfoxApiEndpoint_organizationId_workspaceId_enabled_idx"
  ON "SellfoxApiEndpoint"("organizationId", "workspaceId", "enabled");

CREATE TABLE "SellfoxApiRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "endpointCode" TEXT NOT NULL,
  "storeId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellfoxApiRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxApiRecord_organizationId_workspaceId_endpointCode_scopeKey_period_externalId_key"
  ON "SellfoxApiRecord"("organizationId", "workspaceId", "endpointCode", "scopeKey", "period", "externalId");
CREATE INDEX "SellfoxApiRecord_organizationId_workspaceId_endpointCode_period_idx"
  ON "SellfoxApiRecord"("organizationId", "workspaceId", "endpointCode", "period");
CREATE INDEX "SellfoxApiRecord_organizationId_workspaceId_endpointCode_storeId_idx"
  ON "SellfoxApiRecord"("organizationId", "workspaceId", "endpointCode", "storeId");
