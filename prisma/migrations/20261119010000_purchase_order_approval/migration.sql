CREATE TABLE "PurchaseOrderApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderApproval_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderApproval_requester_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderApproval_approver_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderApproval_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CANCELLED')),
  CONSTRAINT "PurchaseOrderApproval_revision_check" CHECK ("expectedRevision" > 0 AND "revision" > 0)
);
CREATE UNIQUE INDEX "PurchaseOrderApproval_scope_id_key" ON "PurchaseOrderApproval"("organizationId", "workspaceId", "id");
CREATE INDEX "PurchaseOrderApproval_scope_order_created_idx" ON "PurchaseOrderApproval"("organizationId", "workspaceId", "purchaseOrderId", "createdAt");
CREATE INDEX "PurchaseOrderApproval_scope_status_expiry_idx" ON "PurchaseOrderApproval"("organizationId", "workspaceId", "status", "expiresAt");
