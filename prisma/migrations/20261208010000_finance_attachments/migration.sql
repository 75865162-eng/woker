-- CreateTable
CREATE TABLE "FinanceVoucherAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceVoucherAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceVoucherAttachment_voucher_idx" ON "FinanceVoucherAttachment"("organizationId", "workspaceId", "voucherId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherAttachment_content_key" ON "FinanceVoucherAttachment"("organizationId", "workspaceId", "bookId", "voucherId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_scoped_id_key" ON "FileObject"("organizationId", "workspaceId", "id");

-- AddForeignKey
ALTER TABLE "FinanceVoucherAttachment" ADD CONSTRAINT "FinanceVoucherAttachment_voucher_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "voucherId") REFERENCES "FinanceVoucher"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherAttachment" ADD CONSTRAINT "FinanceVoucherAttachment_file_fkey" FOREIGN KEY ("organizationId", "workspaceId", "fileId") REFERENCES "FileObject"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


CREATE FUNCTION finance_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Voucher attachments are append-only evidence'; END IF;
 SELECT x.status,p.status AS period_status INTO v FROM "FinanceVoucher" x JOIN "FinancePeriod" p
 ON p.id=x."periodId" AND p."organizationId"=x."organizationId" AND p."workspaceId"=x."workspaceId" AND p."bookId"=x."bookId"
 WHERE x.id=NEW."voucherId" AND x."organizationId"=NEW."organizationId" AND x."workspaceId"=NEW."workspaceId" AND x."bookId"=NEW."bookId" FOR SHARE OF x,p;
 IF NOT FOUND OR v.status<>'DRAFT' OR v.period_status<>'OPEN' THEN RAISE EXCEPTION 'Attachments require an open-period draft'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "FileObject" f WHERE f.id=NEW."fileId" AND f."organizationId"=NEW."organizationId" AND f."workspaceId"=NEW."workspaceId" AND f."contentHash"=NEW."contentHash" AND f.status='done' AND f."storageKey" LIKE 'finance-evidence/%') THEN RAISE EXCEPTION 'Attachment file identity invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceVoucherAttachment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceVoucherAttachment" FOR EACH ROW EXECUTE FUNCTION finance_attachment_guard();
CREATE FUNCTION finance_attachment_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."storageKey" LIKE 'finance-evidence/%' THEN RAISE EXCEPTION 'Finance evidence files are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "FileObject_finance_guard" BEFORE UPDATE OR DELETE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION finance_attachment_file_guard();
ALTER TABLE "FinanceVoucherAttachment" ADD CONSTRAINT "FinanceVoucherAttachment_hash_check" CHECK ("contentHash" ~ '^[a-f0-9]{64}$');
