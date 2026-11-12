CREATE TABLE "PurchasePaymentApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "currency" TEXT NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "requestHash" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "settledPaymentId" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PurchasePaymentApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePaymentApproval_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentApproval_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentApproval_requester_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentApproval_approver_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentApproval_settlement_fkey" FOREIGN KEY ("organizationId", "workspaceId", "settledPaymentId") REFERENCES "PurchasePayment"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentApproval_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PurchasePaymentApproval_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PurchasePaymentApproval_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CANCELLED')),
  CONSTRAINT "PurchasePaymentApproval_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "PurchasePaymentApproval_scope_id_key" ON "PurchasePaymentApproval"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePaymentApproval_settlement_key" ON "PurchasePaymentApproval"("organizationId", "workspaceId", "settledPaymentId");
CREATE INDEX "PurchasePaymentApproval_order_created_idx" ON "PurchasePaymentApproval"("organizationId", "workspaceId", "purchaseOrderId", "createdAt");
CREATE INDEX "PurchasePaymentApproval_status_expiry_idx" ON "PurchasePaymentApproval"("organizationId", "workspaceId", "status", "expiresAt");
