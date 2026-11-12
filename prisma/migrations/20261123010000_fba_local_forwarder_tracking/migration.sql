CREATE TABLE "FbaLocalForwarderOrder" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "planId" TEXT NOT NULL, "number" TEXT NOT NULL, "forwarder" TEXT NOT NULL,
  "channel" TEXT NOT NULL, "mode" TEXT NOT NULL, "destination" TEXT NOT NULL,
  "containerNumber" TEXT, "billOfLading" TEXT, "vesselOrFlight" TEXT,
  "cutoffAt" TIMESTAMP(3), "departureEta" TIMESTAMP(3), "arrivalEta" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'BOOKED', "lastEventAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalForwarderOrder_mode_check" CHECK ("mode" IN ('OCEAN','AIR','ROAD','RAIL')),
  CONSTRAINT "FbaLocalForwarderOrder_status_check" CHECK ("status" IN ('BOOKED','IN_TRANSIT','ARRIVED','CLEARED','DELIVERED','CANCELLED')),
  CONSTRAINT "FbaLocalForwarderOrder_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalForwarderOrder_scope_id_key" ON "FbaLocalForwarderOrder"("organizationId","workspaceId","id");
CREATE UNIQUE INDEX "FbaLocalForwarderOrder_scope_plan_key" ON "FbaLocalForwarderOrder"("organizationId","workspaceId","planId");
CREATE UNIQUE INDEX "FbaLocalForwarderOrder_scope_number_key" ON "FbaLocalForwarderOrder"("organizationId","workspaceId","number");
CREATE TABLE "FbaLocalTracking" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL, "location" TEXT NOT NULL, "evidence" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL', "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalTracking_type_check" CHECK ("eventType" IN ('DEPARTED','ARRIVED','CLEARED','DELIVERED','NOTE')),
  CONSTRAINT "FbaLocalTracking_source_check" CHECK ("source"='MANUAL'),
  CONSTRAINT "FbaLocalTracking_order_fkey" FOREIGN KEY ("organizationId","workspaceId","orderId") REFERENCES "FbaLocalForwarderOrder"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalTracking_scope_order_request_key" ON "FbaLocalTracking"("organizationId","workspaceId","orderId","idempotencyKey");
CREATE INDEX "FbaLocalTracking_scope_order_time_idx" ON "FbaLocalTracking"("organizationId","workspaceId","orderId","occurredAt","id");
ALTER TABLE "FbaLocalForwarderBill" ADD COLUMN "forwarderOrderId" TEXT;
ALTER TABLE "FbaLocalForwarderBill" ADD CONSTRAINT "FbaLocalForwarderBill_order_fkey" FOREIGN KEY ("organizationId","workspaceId","forwarderOrderId") REFERENCES "FbaLocalForwarderOrder"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT;
