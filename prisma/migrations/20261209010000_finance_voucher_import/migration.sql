-- CreateTable
CREATE TABLE "FinanceVoucherImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "errors" JSONB NOT NULL,
    "voucherIds" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMPTZ(3),

    CONSTRAINT "FinanceVoucherImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceVoucherImport_book_idx" ON "FinanceVoucherImport"("organizationId", "workspaceId", "bookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherImport_idempotency_key" ON "FinanceVoucherImport"("organizationId", "workspaceId", "bookId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "FinanceVoucherImport" ADD CONSTRAINT "FinanceVoucherImport_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "FinanceVoucherImport" ADD CONSTRAINT "FinanceVoucherImport_status_check" CHECK (status IN ('VALIDATED','NEEDS_REVIEW','IMPORTED'));
CREATE FUNCTION finance_voucher_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'VALIDATED' OR NEW.status<>'IMPORTED' OR NEW."importedAt" IS NULL
 OR (to_jsonb(NEW)-ARRAY['status','voucherIds','importedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','voucherIds','importedAt']) THEN RAISE EXCEPTION 'Import source evidence and completed batches are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceVoucherImport_guard" BEFORE UPDATE OR DELETE ON "FinanceVoucherImport" FOR EACH ROW EXECUTE FUNCTION finance_voucher_import_guard();
