CREATE TABLE "FbaLocalFee" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "planId" TEXT NOT NULL, "number" TEXT NOT NULL, "feeType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "estimate" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalFee_type_check" CHECK ("feeType" IN ('OCEAN','AIR','FUEL','CUSTOMS','CLEARANCE','INSURANCE','TRUCKING','OTHER')),
  CONSTRAINT "FbaLocalFee_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalFee_organizationId_workspaceId_id_key" ON "FbaLocalFee"("organizationId","workspaceId","id");
CREATE UNIQUE INDEX "FbaLocalFee_organizationId_workspaceId_planId_number_key" ON "FbaLocalFee"("organizationId","workspaceId","planId","number");
CREATE UNIQUE INDEX "FbaLocalFee_organizationId_workspaceId_planId_idempotencyKey_key" ON "FbaLocalFee"("organizationId","workspaceId","planId","idempotencyKey");
CREATE INDEX "FbaLocalFee_organizationId_workspaceId_planId_createdAt_id_idx" ON "FbaLocalFee"("organizationId","workspaceId","planId","createdAt","id");
CREATE TABLE "FbaLocalForwarderBill" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "feeId" TEXT NOT NULL, "number" TEXT NOT NULL, "forwarder" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "actual" JSONB NOT NULL, "reconciliation" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalForwarderBill_fee_fkey" FOREIGN KEY ("organizationId","workspaceId","feeId") REFERENCES "FbaLocalFee"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalForwarderBill_organizationId_workspaceId_id_key" ON "FbaLocalForwarderBill"("organizationId","workspaceId","id");
CREATE UNIQUE INDEX "FbaLocalForwarderBill_organizationId_workspaceId_feeId_key" ON "FbaLocalForwarderBill"("organizationId","workspaceId","feeId");
CREATE TABLE "FbaLocalCostAdjustment" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
  "billId" TEXT NOT NULL, "currency" TEXT NOT NULL, "difference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEEDS_ACCOUNT_MAPPING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FbaLocalCostAdjustment_status_check" CHECK ("status" = 'NEEDS_ACCOUNT_MAPPING'),
  CONSTRAINT "FbaLocalCostAdjustment_amount_check" CHECK ("difference" ~ '^-?[0-9]+\.[0-9]{6}$'),
  CONSTRAINT "FbaLocalCostAdjustment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "FbaLocalCostAdjustment_bill_fkey" FOREIGN KEY ("organizationId","workspaceId","billId") REFERENCES "FbaLocalForwarderBill"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalCostAdjustment_organizationId_workspaceId_billId_key" ON "FbaLocalCostAdjustment"("organizationId","workspaceId","billId");
