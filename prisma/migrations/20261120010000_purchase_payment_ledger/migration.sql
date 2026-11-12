CREATE TABLE "PurchasePayment" (
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
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchasePayment_order_fkey" FOREIGN KEY ("organizationId", "workspaceId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePayment_creator_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchasePayment_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PurchasePayment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PurchasePayment_method_check" CHECK (length(trim("method")) BETWEEN 1 AND 40),
  CONSTRAINT "PurchasePayment_reference_check" CHECK (length(trim("reference")) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "PurchasePayment_scope_id_key" ON "PurchasePayment"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "PurchasePayment_order_reference_key" ON "PurchasePayment"("organizationId", "workspaceId", "purchaseOrderId", "reference");
CREATE INDEX "PurchasePayment_order_paid_idx" ON "PurchasePayment"("organizationId", "workspaceId", "purchaseOrderId", "paidAt", "id");
CREATE FUNCTION purchase_payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase payment records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "PurchasePayment_immutable" BEFORE UPDATE OR DELETE ON "PurchasePayment"
FOR EACH ROW EXECUTE FUNCTION purchase_payment_immutable();
