CREATE TABLE "FbaLocalShipmentDocument" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"shipmentId" TEXT NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('DELIVERY_APPOINTMENT','INSURANCE','CONTAINER')),"number" TEXT NOT NULL,"evidence" TEXT NOT NULL,"payload" JSONB NOT NULL,
 "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'REGISTERED',
 "cancellationEvidence" TEXT,"cancelledBy" TEXT,"cancelledAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaLocalShipmentDocument_shipment_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","shipmentId") REFERENCES "FbaLocalShipment"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaLocalShipmentDocument_status_check" CHECK (("status"='REGISTERED' AND "cancellationEvidence" IS NULL AND "cancelledBy" IS NULL AND "cancelledAt" IS NULL) OR ("status"='CANCELLED' AND "cancellationEvidence" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelledAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "FbaLocalShipmentDocument_number_key" ON "FbaLocalShipmentDocument"("organizationId","workspaceId","planId","kind","number");
CREATE UNIQUE INDEX "FbaLocalShipmentDocument_request_key" ON "FbaLocalShipmentDocument"("organizationId","workspaceId","planId","idempotencyKey");
CREATE INDEX "FbaLocalShipmentDocument_scope_date_idx" ON "FbaLocalShipmentDocument"("organizationId","workspaceId","planId","createdAt","id");
