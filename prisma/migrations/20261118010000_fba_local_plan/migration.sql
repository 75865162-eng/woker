-- Additive, local FBA planning only. No historical data rewrite or remote action.
CREATE TABLE "FbaLocalPlan" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sellerAccountId" TEXT NOT NULL,
  "marketplaceId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FbaLocalPlan_state_check" CHECK ("status" IN ('DRAFT','ACTIVE','CANCELLED') AND "revision" > 0),
  CONSTRAINT "FbaLocalPlan_workspace_fkey" FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalPlan_seller_fkey" FOREIGN KEY ("organizationId","workspaceId","sellerAccountId") REFERENCES "SellerAccount"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalPlan_creator_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalPlan_organizationId_workspaceId_id_key" ON "FbaLocalPlan"("organizationId","workspaceId","id");
CREATE UNIQUE INDEX "FbaLocalPlan_organizationId_workspaceId_number_key" ON "FbaLocalPlan"("organizationId","workspaceId","number");
CREATE UNIQUE INDEX "FbaLocalPlan_organizationId_workspaceId_idempotencyKey_key" ON "FbaLocalPlan"("organizationId","workspaceId","idempotencyKey");
CREATE INDEX "FbaLocalPlan_scope_seller_site_date_idx" ON "FbaLocalPlan"("organizationId","workspaceId","sellerAccountId","marketplaceId","createdAt","id");

CREATE TABLE "FbaLocalPlanLine" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "balanceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "reservationId" TEXT,
  CONSTRAINT "FbaLocalPlanLine_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalPlanLine_balance_fkey" FOREIGN KEY ("organizationId","workspaceId","balanceId") REFERENCES "WmsStockBalance"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FbaLocalPlanLine_reservation_fkey" FOREIGN KEY ("organizationId","workspaceId","reservationId") REFERENCES "WmsReservation"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaLocalPlanLine_scope_plan_balance_key" ON "FbaLocalPlanLine"("organizationId","workspaceId","planId","balanceId");
CREATE UNIQUE INDEX "FbaLocalPlanLine_scope_reservation_key" ON "FbaLocalPlanLine"("organizationId","workspaceId","reservationId");
