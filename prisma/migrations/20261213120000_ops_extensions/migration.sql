CREATE TABLE "Carrier" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "serviceLevel" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "trackingUrlPattern" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Carrier_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Carrier_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Carrier_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 40 AND length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "Carrier_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "Carrier_scope_id_key" ON "Carrier"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "Carrier_code_key" ON "Carrier"("organizationId", "workspaceId", "code");
CREATE INDEX "Carrier_scope_enabled_idx" ON "Carrier"("organizationId", "workspaceId", "enabled", "code");

CREATE TABLE "ThirdPartyWarehouse" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accountRef" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThirdPartyWarehouse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ThirdPartyWarehouse_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ThirdPartyWarehouse_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ThirdPartyWarehouse_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 40 AND length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "ThirdPartyWarehouse_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT "ThirdPartyWarehouse_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "ThirdPartyWarehouse_scope_id_key" ON "ThirdPartyWarehouse"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "ThirdPartyWarehouse_code_key" ON "ThirdPartyWarehouse"("organizationId", "workspaceId", "code");
CREATE INDEX "ThirdPartyWarehouse_scope_status_idx" ON "ThirdPartyWarehouse"("organizationId", "workspaceId", "status", "code");

CREATE TABLE "UnsalableAssessment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "warehouseId" TEXT NOT NULL,
  "asOfDate" DATE NOT NULL,
  "policyReference" TEXT NOT NULL,
  "slowDays" INTEGER NOT NULL,
  "minSalesQty" INTEGER NOT NULL,
  "records" JSONB NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CAPTURED',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnsalableAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnsalableAssessment_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UnsalableAssessment_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "UnsalableAssessment_policy_check" CHECK ("slowDays" > 0 AND "minSalesQty" >= 0 AND "recordCount" >= 0 AND length("sourceHash") = 64),
  CONSTRAINT "UnsalableAssessment_status_check" CHECK ("status" IN ('CAPTURED', 'SUPERSEDED'))
);
CREATE UNIQUE INDEX "UnsalableAssessment_scope_id_key" ON "UnsalableAssessment"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "UnsalableAssessment_day_key" ON "UnsalableAssessment"("organizationId", "workspaceId", "warehouseId", "asOfDate");
CREATE INDEX "UnsalableAssessment_scope_date_idx" ON "UnsalableAssessment"("organizationId", "workspaceId", "asOfDate");
