CREATE UNIQUE INDEX "Supplier_organizationId_id_key" ON "Supplier"("organizationId", "id");

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "expectedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "wmsReceiptIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_supplier_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseOrder_scope_id_key" ON "PurchaseOrder"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchaseOrder_scope_number_key" ON "PurchaseOrder"("organizationId", "workspaceId", "number");
CREATE INDEX "PurchaseOrder_scope_status_updated_idx" ON "PurchaseOrder"("organizationId", "workspaceId", "status", "updatedAt");
CREATE INDEX "PurchaseOrder_scope_supplier_created_idx" ON "PurchaseOrder"("organizationId", "workspaceId", "supplierId", "createdAt");

CREATE TABLE "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "purchaseOrderId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "expectedQty" INTEGER NOT NULL,
  "unitPrice" DECIMAL(20,6) NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderLine_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderLine_product_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderLine_expected_qty_check" CHECK ("expectedQty" > 0)
);
CREATE UNIQUE INDEX "PurchaseOrderLine_scope_id_key" ON "PurchaseOrderLine"("organizationId", "workspaceId", "id");
CREATE INDEX "PurchaseOrderLine_scope_order_idx" ON "PurchaseOrderLine"("organizationId", "workspaceId", "purchaseOrderId");
CREATE INDEX "PurchaseOrderLine_scope_product_idx" ON "PurchaseOrderLine"("organizationId", "workspaceId", "productRecordId");
