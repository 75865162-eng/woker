CREATE TABLE "WmsBom" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'V1',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WmsBom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WmsBom_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsBom_product_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsBom_version_check" CHECK (length(btrim("version")) BETWEEN 1 AND 40),
  CONSTRAINT "WmsBom_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "WmsBom_scope_id_key" ON "WmsBom"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsBom_version_key" ON "WmsBom"("organizationId", "workspaceId", "productRecordId", "version");
CREATE INDEX "WmsBom_scope_product_idx" ON "WmsBom"("organizationId", "workspaceId", "productRecordId");

CREATE TABLE "WmsBomLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "componentProductRecordId" TEXT NOT NULL,
  "quantityPer" INTEGER NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "WmsBomLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WmsBomLine_bom_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bomId") REFERENCES "WmsBom"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WmsBomLine_component_fkey" FOREIGN KEY ("organizationId", "workspaceId", "componentProductRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsBomLine_quantity_check" CHECK ("quantityPer" > 0)
);
CREATE UNIQUE INDEX "WmsBomLine_scope_id_key" ON "WmsBomLine"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsBomLine_component_key" ON "WmsBomLine"("organizationId", "workspaceId", "bomId", "componentProductRecordId");

CREATE TABLE "WmsAssemblyOrder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "bomId" TEXT,
  "productRecordId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "lotId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "plannedQty" INTEGER NOT NULL,
  "outputQty" INTEGER NOT NULL DEFAULT 0,
  "componentCost" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "notes" TEXT NOT NULL DEFAULT '',
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "completedCommandId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WmsAssemblyOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WmsAssemblyOrder_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrder_product_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrder_bom_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bomId") REFERENCES "WmsBom"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrder_location_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "locationId") REFERENCES "WmsLocation"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrder_status_check" CHECK ("status" IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "WmsAssemblyOrder_qty_check" CHECK ("plannedQty" > 0 AND "outputQty" >= 0 AND "outputQty" <= "plannedQty"),
  CONSTRAINT "WmsAssemblyOrder_cost_check" CHECK ("componentCost" >= 0 AND "unitCost" >= 0),
  CONSTRAINT "WmsAssemblyOrder_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "WmsAssemblyOrder_scope_id_key" ON "WmsAssemblyOrder"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsAssemblyOrder_number_key" ON "WmsAssemblyOrder"("organizationId", "workspaceId", "number");
CREATE UNIQUE INDEX "WmsAssemblyOrder_request_key" ON "WmsAssemblyOrder"("organizationId", "workspaceId", "idempotencyKey");
CREATE INDEX "WmsAssemblyOrder_scope_created_idx" ON "WmsAssemblyOrder"("organizationId", "workspaceId", "createdAt", "id");
CREATE INDEX "WmsAssemblyOrder_scope_status_idx" ON "WmsAssemblyOrder"("organizationId", "workspaceId", "status");

CREATE TABLE "WmsAssemblyOrderLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "componentProductRecordId" TEXT NOT NULL,
  "balanceId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantityPer" INTEGER NOT NULL,
  "plannedQty" INTEGER NOT NULL,
  "consumedQty" INTEGER NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "amount" DECIMAL(24,6) NOT NULL DEFAULT 0,
  CONSTRAINT "WmsAssemblyOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WmsAssemblyOrderLine_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "orderId") REFERENCES "WmsAssemblyOrder"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrderLine_component_fkey" FOREIGN KEY ("organizationId", "workspaceId", "componentProductRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrderLine_balance_fkey" FOREIGN KEY ("organizationId", "workspaceId", "balanceId") REFERENCES "WmsStockBalance"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WmsAssemblyOrderLine_qty_check" CHECK ("plannedQty" > 0 AND "consumedQty" >= 0 AND "consumedQty" <= "plannedQty"),
  CONSTRAINT "WmsAssemblyOrderLine_cost_check" CHECK ("unitCost" >= 0 AND "amount" >= 0)
);
CREATE UNIQUE INDEX "WmsAssemblyOrderLine_scope_id_key" ON "WmsAssemblyOrderLine"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsAssemblyOrderLine_balance_key" ON "WmsAssemblyOrderLine"("organizationId", "workspaceId", "orderId", "balanceId");
CREATE INDEX "WmsAssemblyOrderLine_scope_order_idx" ON "WmsAssemblyOrderLine"("organizationId", "workspaceId", "orderId");
