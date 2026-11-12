CREATE UNIQUE INDEX "FbaLocalPlanLine_scope_plan_id_key" ON "FbaLocalPlanLine"("organizationId","workspaceId","planId","id");
CREATE TABLE "FbaLocalShipment" (
  "id" TEXT NOT NULL PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,"marketplaceId" TEXT NOT NULL,"sourceId" TEXT NOT NULL,"sourceRunId" TEXT NOT NULL,"observationId" TEXT NOT NULL,
  "spApiInboundPlanId" TEXT NOT NULL,"spApiShipmentId" TEXT NOT NULL,"sourceStatus" TEXT,"warehouseId" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,"sourceFacts" JSONB NOT NULL,"mappingEvidence" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalShipment_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalShipment_run_fkey" FOREIGN KEY ("sourceRunId","organizationId","workspaceId","sourceId") REFERENCES "AmazonSyncRun"("id","organizationId","workspaceId","sourceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalShipment_scope_plan_id_key" ON "FbaLocalShipment"("organizationId","workspaceId","planId","id");
CREATE UNIQUE INDEX "FbaLocalShipment_scope_amazon_key" ON "FbaLocalShipment"("organizationId","workspaceId","sellerAccountId","marketplaceId","spApiShipmentId");
CREATE UNIQUE INDEX "FbaLocalShipment_scope_request_key" ON "FbaLocalShipment"("organizationId","workspaceId","planId","idempotencyKey");
CREATE TABLE "FbaLocalShipmentItem" (
  "id" TEXT NOT NULL PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"shipmentId" TEXT NOT NULL,
  "planLineId" TEXT NOT NULL,"observationId" TEXT NOT NULL,"sellerSku" TEXT NOT NULL,"fnsku" TEXT,"quantity" INTEGER NOT NULL,
  CONSTRAINT "FbaLocalShipmentItem_qty_check" CHECK ("quantity">0),
  CONSTRAINT "FbaLocalShipmentItem_shipment_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","shipmentId") REFERENCES "FbaLocalShipment"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalShipmentItem_planline_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","planLineId") REFERENCES "FbaLocalPlanLine"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalShipmentItem_source_line_key" ON "FbaLocalShipmentItem"("shipmentId","observationId","planLineId");
