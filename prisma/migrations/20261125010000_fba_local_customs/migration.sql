CREATE TABLE "FbaLocalCustomsDeclaration" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"shipmentId" TEXT NOT NULL,
 "number" TEXT NOT NULL,"destinationCountry" TEXT NOT NULL,"currency" TEXT NOT NULL,"exporter" TEXT NOT NULL,"importer" TEXT NOT NULL,
 "templateReference" TEXT NOT NULL,"evidence" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,
 "reviewedBy" TEXT,"reviewedAt" TIMESTAMP(3),"status" TEXT NOT NULL DEFAULT 'DRAFT',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaLocalCustomsDeclaration_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaLocalCustomsDeclaration_shipment_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","shipmentId") REFERENCES "FbaLocalShipment"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaLocalCustomsDeclaration_status_check" CHECK ("status" IN ('DRAFT','REVIEWED','CANCELLED')),
 CONSTRAINT "FbaLocalCustomsDeclaration_reviewer_check" CHECK (("status"='REVIEWED' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL) OR ("status"<>'REVIEWED'))
);
CREATE UNIQUE INDEX "FbaLocalCustomsDeclaration_scope_plan_id_key" ON "FbaLocalCustomsDeclaration"("organizationId","workspaceId","planId","id");
CREATE UNIQUE INDEX "FbaLocalCustomsDeclaration_number_key" ON "FbaLocalCustomsDeclaration"("organizationId","workspaceId","planId","number");
CREATE UNIQUE INDEX "FbaLocalCustomsDeclaration_request_key" ON "FbaLocalCustomsDeclaration"("organizationId","workspaceId","planId","idempotencyKey");
CREATE TABLE "FbaLocalCustomsItem" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"declarationId" TEXT NOT NULL,"planLineId" TEXT NOT NULL,
 "description" TEXT NOT NULL,"hsCode" TEXT NOT NULL,"originCountry" TEXT NOT NULL,"quantity" INTEGER NOT NULL CHECK ("quantity">0),"unit" TEXT NOT NULL,"unitPrice" TEXT NOT NULL,"declaredValue" TEXT NOT NULL,
 CONSTRAINT "FbaLocalCustomsItem_declaration_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","declarationId") REFERENCES "FbaLocalCustomsDeclaration"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaLocalCustomsItem_planline_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","planLineId") REFERENCES "FbaLocalPlanLine"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalCustomsItem_line_key" ON "FbaLocalCustomsItem"("declarationId","planLineId");
CREATE TABLE "FbaLocalClearanceEvent" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"declarationId" TEXT NOT NULL,
 "eventType" TEXT NOT NULL CHECK ("eventType" IN ('FILED','HELD','RELEASED','REJECTED')),"occurredAt" TIMESTAMP(3) NOT NULL,"reference" TEXT NOT NULL,"evidence" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaLocalClearanceEvent_declaration_fkey" FOREIGN KEY ("organizationId","workspaceId","planId","declarationId") REFERENCES "FbaLocalCustomsDeclaration"("organizationId","workspaceId","planId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalClearanceEvent_request_key" ON "FbaLocalClearanceEvent"("declarationId","idempotencyKey");
CREATE INDEX "FbaLocalClearanceEvent_scope_date_idx" ON "FbaLocalClearanceEvent"("organizationId","workspaceId","planId","declarationId","occurredAt","id");
