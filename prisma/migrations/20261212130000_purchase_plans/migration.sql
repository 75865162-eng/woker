CREATE TABLE "PurchasePlan" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "supplierId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "salesWindowDays" INTEGER NOT NULL DEFAULT 90,
  "coverageDays" INTEGER NOT NULL DEFAULT 60,
  "safetyDays" INTEGER NOT NULL DEFAULT 15,
  "notes" TEXT NOT NULL DEFAULT '',
  "convertedOrderId" TEXT,
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchasePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlan_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlan_supplier_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlan_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CONVERTED', 'CANCELLED')),
  CONSTRAINT "PurchasePlan_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "PurchasePlan_period_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "PurchasePlan_window_check" CHECK ("salesWindowDays" BETWEEN 1 AND 365 AND "coverageDays" BETWEEN 1 AND 365 AND "safetyDays" BETWEEN 0 AND 365),
  CONSTRAINT "PurchasePlan_number_check" CHECK (length(btrim("number")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "PurchasePlan_scope_id_key" ON "PurchasePlan"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePlan_scope_number_key" ON "PurchasePlan"("organizationId", "workspaceId", "number");
CREATE INDEX "PurchasePlan_scope_status_period_idx" ON "PurchasePlan"("organizationId", "workspaceId", "status", "periodStart");
CREATE INDEX "PurchasePlan_scope_supplier_created_idx" ON "PurchasePlan"("organizationId", "workspaceId", "supplierId", "createdAt");

CREATE TABLE "PurchasePlanLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "planId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "onHandQty" INTEGER NOT NULL DEFAULT 0,
  "inboundQty" INTEGER NOT NULL DEFAULT 0,
  "salesQty" INTEGER NOT NULL DEFAULT 0,
  "suggestedQty" INTEGER NOT NULL DEFAULT 0,
  "plannedQty" INTEGER NOT NULL,
  "unitPrice" DECIMAL(20,6) NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchasePlanLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePlanLine_plan_fkey" FOREIGN KEY ("organizationId", "workspaceId", "planId") REFERENCES "PurchasePlan"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlanLine_product_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlanLine_planned_qty_check" CHECK ("plannedQty" > 0),
  CONSTRAINT "PurchasePlanLine_snapshot_check" CHECK ("onHandQty" >= 0 AND "inboundQty" >= 0 AND "salesQty" >= 0 AND "suggestedQty" >= 0),
  CONSTRAINT "PurchasePlanLine_price_check" CHECK ("unitPrice" >= 0)
);
CREATE UNIQUE INDEX "PurchasePlanLine_scope_id_key" ON "PurchasePlanLine"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePlanLine_scope_plan_product_key" ON "PurchasePlanLine"("organizationId", "workspaceId", "planId", "productRecordId");
CREATE INDEX "PurchasePlanLine_scope_plan_idx" ON "PurchasePlanLine"("organizationId", "workspaceId", "planId");

CREATE TABLE "PurchasePlanApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expectedRevision" INTEGER NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchasePlanApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePlanApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlanApproval_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlanApproval_plan_fkey" FOREIGN KEY ("organizationId", "workspaceId", "planId") REFERENCES "PurchasePlan"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchasePlanApproval_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "PurchasePlanApproval_scope_id_key" ON "PurchasePlanApproval"("organizationId", "workspaceId", "id");
CREATE INDEX "PurchasePlanApproval_scope_plan_status_idx" ON "PurchasePlanApproval"("organizationId", "workspaceId", "planId", "status");
