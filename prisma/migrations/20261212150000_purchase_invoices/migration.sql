CREATE TABLE "PurchaseInvoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "number" TEXT NOT NULL,
  "supplierInvoiceNo" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "matchStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "invoiceDate" DATE NOT NULL,
  "dueDate" DATE,
  "qtyToleranceBp" INTEGER NOT NULL DEFAULT 0,
  "priceToleranceBp" INTEGER NOT NULL DEFAULT 50,
  "amountTolerance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(20,6) NOT NULL,
  "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(20,6) NOT NULL,
  "exceptionSummary" TEXT NOT NULL DEFAULT '',
  "matchedAt" TIMESTAMP(3),
  "overrideReason" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoice_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoice_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoice_supplier_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoice_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'VOID')),
  CONSTRAINT "PurchaseInvoice_match_check" CHECK ("matchStatus" IN ('PENDING', 'MATCHED', 'EXCEPTION')),
  CONSTRAINT "PurchaseInvoice_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "PurchaseInvoice_date_check" CHECK ("dueDate" IS NULL OR "dueDate" >= "invoiceDate"),
  CONSTRAINT "PurchaseInvoice_tolerance_check" CHECK ("qtyToleranceBp" BETWEEN 0 AND 10000 AND "priceToleranceBp" BETWEEN 0 AND 10000 AND "amountTolerance" >= 0),
  CONSTRAINT "PurchaseInvoice_amount_check" CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "totalAmount" >= 0),
  CONSTRAINT "PurchaseInvoice_number_check" CHECK (length(btrim("number")) BETWEEN 1 AND 80 AND length(btrim("supplierInvoiceNo")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "PurchaseInvoice_scope_id_key" ON "PurchaseInvoice"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchaseInvoice_scope_number_key" ON "PurchaseInvoice"("organizationId", "workspaceId", "number");
CREATE UNIQUE INDEX "PurchaseInvoice_scope_supplier_no_key" ON "PurchaseInvoice"("organizationId", "workspaceId", "supplierId", "supplierInvoiceNo");
CREATE INDEX "PurchaseInvoice_scope_status_date_idx" ON "PurchaseInvoice"("organizationId", "workspaceId", "status", "invoiceDate");
CREATE INDEX "PurchaseInvoice_scope_order_idx" ON "PurchaseInvoice"("organizationId", "workspaceId", "purchaseOrderId");

CREATE TABLE "PurchaseInvoiceLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "invoiceId" TEXT NOT NULL,
  "productRecordId" TEXT NOT NULL,
  "orderedQty" INTEGER NOT NULL,
  "receivedQty" INTEGER NOT NULL DEFAULT 0,
  "invoicedQty" INTEGER NOT NULL,
  "poUnitPrice" DECIMAL(20,6) NOT NULL,
  "unitPrice" DECIMAL(20,6) NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "varianceQty" INTEGER NOT NULL DEFAULT 0,
  "varianceAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "exceptionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseInvoiceLine_invoice_fkey" FOREIGN KEY ("organizationId", "workspaceId", "invoiceId") REFERENCES "PurchaseInvoice"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoiceLine_product_fkey" FOREIGN KEY ("organizationId", "workspaceId", "productRecordId") REFERENCES "ProductRecord"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoiceLine_qty_check" CHECK ("orderedQty" > 0 AND "receivedQty" >= 0 AND "invoicedQty" > 0),
  CONSTRAINT "PurchaseInvoiceLine_price_check" CHECK ("poUnitPrice" >= 0 AND "unitPrice" >= 0 AND "amount" >= 0 AND "taxAmount" >= 0)
);
CREATE UNIQUE INDEX "PurchaseInvoiceLine_scope_id_key" ON "PurchaseInvoiceLine"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchaseInvoiceLine_scope_invoice_product_key" ON "PurchaseInvoiceLine"("organizationId", "workspaceId", "invoiceId", "productRecordId");
CREATE INDEX "PurchaseInvoiceLine_scope_invoice_idx" ON "PurchaseInvoiceLine"("organizationId", "workspaceId", "invoiceId");

CREATE TABLE "PurchaseInvoiceApproval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "invoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expectedRevision" INTEGER NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "overrideReason" TEXT NOT NULL DEFAULT '',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoiceApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseInvoiceApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoiceApproval_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoiceApproval_invoice_fkey" FOREIGN KEY ("organizationId", "workspaceId", "invoiceId") REFERENCES "PurchaseInvoice"("organizationId", "workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseInvoiceApproval_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CONSUMED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "PurchaseInvoiceApproval_scope_id_key" ON "PurchaseInvoiceApproval"("organizationId", "workspaceId", "id");
CREATE INDEX "PurchaseInvoiceApproval_scope_invoice_status_idx" ON "PurchaseInvoiceApproval"("organizationId", "workspaceId", "invoiceId", "status");
