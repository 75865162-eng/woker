CREATE TABLE "WmsTransferOrder" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"number" TEXT NOT NULL,"reason" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','PARTIALLY_SHIPPED','IN_TRANSIT','PARTIALLY_RECEIVED','COMPLETED','CANCELLED')),"revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WmsTransferOrder_workspace_fkey" FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsTransferOrder_scope_id_key" ON "WmsTransferOrder"("organizationId","workspaceId","id");
CREATE UNIQUE INDEX "WmsTransferOrder_number_key" ON "WmsTransferOrder"("organizationId","workspaceId","number");
CREATE UNIQUE INDEX "WmsTransferOrder_request_key" ON "WmsTransferOrder"("organizationId","workspaceId","idempotencyKey");
CREATE INDEX "WmsTransferOrder_scope_date_idx" ON "WmsTransferOrder"("organizationId","workspaceId","createdAt","id");
CREATE TABLE "WmsTransferOrderLine" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"orderId" TEXT NOT NULL,"sourceBalanceId" TEXT NOT NULL,"targetWarehouseId" TEXT NOT NULL,"targetLocationId" TEXT NOT NULL,"quantity" INTEGER NOT NULL,"shippedQty" INTEGER NOT NULL DEFAULT 0,"receivedQty" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "WmsTransferOrderLine_quantity_check" CHECK ("quantity">0 AND "shippedQty">=0 AND "shippedQty"<="quantity" AND "receivedQty">=0 AND "receivedQty"<="shippedQty"),
 CONSTRAINT "WmsTransferOrderLine_order_fkey" FOREIGN KEY ("organizationId","workspaceId","orderId") REFERENCES "WmsTransferOrder"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "WmsTransferOrderLine_source_fkey" FOREIGN KEY ("organizationId","workspaceId","sourceBalanceId") REFERENCES "WmsStockBalance"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "WmsTransferOrderLine_target_fkey" FOREIGN KEY ("organizationId","workspaceId","targetWarehouseId","targetLocationId") REFERENCES "WmsLocation"("organizationId","workspaceId","warehouseId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsTransferOrderLine_route_key" ON "WmsTransferOrderLine"("orderId","sourceBalanceId","targetLocationId");
