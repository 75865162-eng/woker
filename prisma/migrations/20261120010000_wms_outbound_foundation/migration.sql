-- t_erp_outwh_form: outbound demand header. Reservations remain the stock allocation fact.
CREATE TYPE "WmsOutboundStatus" AS ENUM ('DRAFT', 'RELEASED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "WmsOutbound" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer" TEXT,
    "deliveryAddress" TEXT,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "remark" TEXT,
    "status" "WmsOutboundStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WmsOutbound_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WmsOutbound_metadata_check" CHECK ("revision" > 0)
);

CREATE TABLE "WmsOutboundLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "outboundId" TEXT NOT NULL,
    "productRecordId" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WmsOutboundLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WmsOutboundLine_metadata_check" CHECK ("revision" > 0 AND "requestedQty" > 0)
);

CREATE UNIQUE INDEX "WmsOutbound_organizationId_workspaceId_id_key" ON "WmsOutbound"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsOutbound_scope_warehouse_key" ON "WmsOutbound"("organizationId", "workspaceId", "warehouseId", "id");
CREATE UNIQUE INDEX "WmsOutbound_organizationId_workspaceId_number_key" ON "WmsOutbound"("organizationId", "workspaceId", "number");
CREATE INDEX "WmsOutbound_work_idx" ON "WmsOutbound"("organizationId", "workspaceId", "warehouseId", "status", "createdAt", "id");
CREATE UNIQUE INDEX "WmsOutboundLine_organizationId_workspaceId_id_key" ON "WmsOutboundLine"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "WmsOutboundLine_scope_product_key" ON "WmsOutboundLine"("organizationId", "workspaceId", "outboundId", "productRecordId");
CREATE INDEX "WmsOutboundLine_product_idx" ON "WmsOutboundLine"("organizationId", "workspaceId", "productRecordId", "createdAt", "id");

ALTER TABLE "WmsOutbound" ADD CONSTRAINT "WmsOutbound_organizationId_workspaceId_warehouseId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId") REFERENCES "WmsWarehouse"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WmsOutbound" ADD CONSTRAINT "WmsOutbound_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WmsOutboundLine" ADD CONSTRAINT "WmsOutboundLine_organizationId_workspaceId_warehouseId_out_fkey" FOREIGN KEY ("organizationId", "workspaceId", "warehouseId", "outboundId") REFERENCES "WmsOutbound"("organizationId", "workspaceId", "warehouseId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "WmsOutboundLine" ADD CONSTRAINT "WmsOutboundLine_organizationId_workspaceId_productRecordId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
