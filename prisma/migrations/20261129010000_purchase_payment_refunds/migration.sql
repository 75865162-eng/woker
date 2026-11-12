CREATE TABLE "PurchasePaymentRefund" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "currency" TEXT NOT NULL,
  "refundedAt" TIMESTAMPTZ(3) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchasePaymentRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePaymentRefund_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefund_payment_fkey" FOREIGN KEY ("organizationId", "workspaceId", "paymentId") REFERENCES "PurchasePayment"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentRefund_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefund_creator_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefund_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PurchasePaymentRefund_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PurchasePaymentRefund_method_check" CHECK (length(trim("method")) BETWEEN 1 AND 40),
  CONSTRAINT "PurchasePaymentRefund_reference_check" CHECK (length(trim("reference")) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "PurchasePaymentRefund_scope_id_key" ON "PurchasePaymentRefund"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePaymentRefund_order_reference_key" ON "PurchasePaymentRefund"("organizationId", "workspaceId", "purchaseOrderId", "reference");
CREATE INDEX "PurchasePaymentRefund_payment_refunded_idx" ON "PurchasePaymentRefund"("organizationId", "workspaceId", "paymentId", "refundedAt", "id");
CREATE FUNCTION purchase_payment_refund_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase payment refund records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "PurchasePaymentRefund_immutable" BEFORE UPDATE OR DELETE ON "PurchasePaymentRefund"
FOR EACH ROW EXECUTE FUNCTION purchase_payment_refund_immutable();

CREATE TABLE "PurchasePaymentRefundApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "currency" TEXT NOT NULL,
  "refundedAt" TIMESTAMPTZ(3) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "requestHash" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "settledRefundId" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PurchasePaymentRefundApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePaymentRefundApproval_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentRefundApproval_payment_fkey" FOREIGN KEY ("organizationId", "workspaceId", "paymentId") REFERENCES "PurchasePayment"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentRefundApproval_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefundApproval_requester_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefundApproval_approver_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePaymentRefundApproval_settlement_fkey" FOREIGN KEY ("organizationId", "workspaceId", "settledRefundId") REFERENCES "PurchasePaymentRefund"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PurchasePaymentRefundApproval_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PurchasePaymentRefundApproval_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PurchasePaymentRefundApproval_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CANCELLED')),
  CONSTRAINT "PurchasePaymentRefundApproval_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "PurchasePaymentRefundApproval_scope_id_key" ON "PurchasePaymentRefundApproval"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePaymentRefundApproval_settlement_key" ON "PurchasePaymentRefundApproval"("organizationId", "workspaceId", "settledRefundId");
CREATE INDEX "PurchasePaymentRefundApproval_payment_created_idx" ON "PurchasePaymentRefundApproval"("organizationId", "workspaceId", "paymentId", "createdAt");
CREATE INDEX "PurchasePaymentRefundApproval_status_expiry_idx" ON "PurchasePaymentRefundApproval"("organizationId", "workspaceId", "status", "expiresAt");
