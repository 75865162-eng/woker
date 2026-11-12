-- AlterTable
ALTER TABLE "FinanceSubject" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "WmsStocktake" ADD COLUMN     "blind" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'SAMPLE',
ADD COLUMN     "selectionEvidence" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FinanceCurrency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCurrency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSubjectCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryType" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceSubjectCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maskedNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "policyReference" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(30,6) NOT NULL,
    "evidence" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceBankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "amount" DECIMAL(30,6) NOT NULL,
    "evidence" TEXT NOT NULL,
    "matchedBy" TEXT NOT NULL,
    "matchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalEvidence" TEXT,

    CONSTRAINT "FinanceBankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceBankMatchEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "voucherLineId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FinanceBankMatchEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WmsAgingSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "policyReference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsAgingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCurrency_code_key" ON "FinanceCurrency"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE INDEX "FinanceExchangeRate_pair_idx" ON "FinanceExchangeRate"("organizationId", "workspaceId", "bookId", "sourceCurrency", "targetCurrency", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceExchangeRate_reference_key" ON "FinanceExchangeRate"("organizationId", "workspaceId", "bookId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubjectCategory_scope_key" ON "FinanceSubjectCategory"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubjectCategory_code_key" ON "FinanceSubjectCategory"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankAccount_scope_key" ON "FinanceBankAccount"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankAccount_code_key" ON "FinanceBankAccount"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankAccount_subject_key" ON "FinanceBankAccount"("organizationId", "workspaceId", "bookId", "subjectId");

-- CreateIndex
CREATE INDEX "FinanceBankStatement_date_idx" ON "FinanceBankStatement"("organizationId", "workspaceId", "bookId", "accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankStatement_scope_key" ON "FinanceBankStatement"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankStatement_reference_key" ON "FinanceBankStatement"("organizationId", "workspaceId", "bookId", "accountId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBankMatch_scope_key" ON "FinanceBankMatch"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE INDEX "FinanceBankMatchEntry_line_idx" ON "FinanceBankMatchEntry"("organizationId", "workspaceId", "bookId", "voucherLineId");

-- CreateIndex
CREATE INDEX "WmsAgingSnapshot_day_idx" ON "WmsAgingSnapshot"("organizationId", "workspaceId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "WmsAgingSnapshot_day_key" ON "WmsAgingSnapshot"("organizationId", "workspaceId", "warehouseId", "snapshotDate");

-- AddForeignKey
ALTER TABLE "FinanceSubject" ADD CONSTRAINT "FinanceSubject_category_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "categoryId") REFERENCES "FinanceSubjectCategory"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceCurrency" ADD CONSTRAINT "FinanceCurrency_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceExchangeRate" ADD CONSTRAINT "FinanceExchangeRate_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubjectCategory" ADD CONSTRAINT "FinanceSubjectCategory_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubjectCategory" ADD CONSTRAINT "FinanceSubjectCategory_parent_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "parentId") REFERENCES "FinanceSubjectCategory"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBankAccount" ADD CONSTRAINT "FinanceBankAccount_book_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBankAccount" ADD CONSTRAINT "FinanceBankAccount_subject_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "subjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBankStatement" ADD CONSTRAINT "FinanceBankStatement_organizationId_workspaceId_bookId_acc_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "accountId") REFERENCES "FinanceBankAccount"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBankMatch" ADD CONSTRAINT "FinanceBankMatch_organizationId_workspaceId_bookId_stateme_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "statementId") REFERENCES "FinanceBankStatement"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBankMatchEntry" ADD CONSTRAINT "FinanceBankMatchEntry_organizationId_workspaceId_bookId_ma_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "matchId") REFERENCES "FinanceBankMatch"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "FinanceBankMatchEntry" ADD CONSTRAINT "FinanceBankMatchEntry_line_fkey" FOREIGN KEY ("voucherLineId") REFERENCES "FinanceVoucherLine"(id) ON DELETE RESTRICT;
ALTER TABLE "FinanceBankMatch" ADD CONSTRAINT "FinanceBankMatch_period_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","periodId") REFERENCES "FinancePeriod"("organizationId","workspaceId","bookId",id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "FinanceBankMatch_active_statement_key" ON "FinanceBankMatch"("organizationId","workspaceId","bookId","statementId") WHERE "reversedAt" IS NULL;
CREATE UNIQUE INDEX "FinanceBankMatchEntry_active_line_key" ON "FinanceBankMatchEntry"("organizationId","workspaceId","bookId","voucherLineId") WHERE active;
CREATE TRIGGER "FinanceCurrency_guard" BEFORE UPDATE OR DELETE ON "FinanceCurrency" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceSubjectCategory_guard" BEFORE UPDATE OR DELETE ON "FinanceSubjectCategory" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceBankAccount_guard" BEFORE UPDATE OR DELETE ON "FinanceBankAccount" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceBankStatement_guard" BEFORE UPDATE OR DELETE ON "FinanceBankStatement" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "WmsAgingSnapshot_guard" BEFORE UPDATE OR DELETE ON "WmsAgingSnapshot" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
ALTER TABLE "FinanceExchangeRate" ADD CONSTRAINT "FinanceExchangeRate_values_check" CHECK (rate>0 AND "sourceCurrency"<>"targetCurrency" AND status IN ('DRAFT','ACTIVE'));
ALTER TABLE "FinanceBankStatement" ADD CONSTRAINT "FinanceBankStatement_amount_check" CHECK (amount<>0 AND "sourceRow">0);
ALTER TABLE "WmsStocktake" ADD CONSTRAINT "WmsStocktake_mode_check" CHECK (mode IN ('FULL','SAMPLE','ACTIVITY'));
CREATE FUNCTION finance_exchange_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'DRAFT' OR NEW.status<>'ACTIVE' OR NEW."reviewedBy" IS NULL OR NEW."reviewedBy"=OLD."createdBy" OR NEW."reviewedAt" IS NULL
 OR (to_jsonb(NEW)-ARRAY['status','reviewedBy','reviewedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewedBy','reviewedAt']) THEN RAISE EXCEPTION 'Exchange rate evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceExchangeRate_guard" BEFORE UPDATE OR DELETE ON "FinanceExchangeRate" FOR EACH ROW EXECUTE FUNCTION finance_exchange_rate_guard();
CREATE FUNCTION finance_bank_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD."reversedAt" IS NOT NULL OR NEW."reversedAt" IS NULL OR NEW."reversedBy" IS NULL OR NEW."reversalEvidence" IS NULL
 OR (to_jsonb(NEW)-ARRAY['reversedAt','reversedBy','reversalEvidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reversedAt','reversedBy','reversalEvidence']) THEN RAISE EXCEPTION 'Bank match evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatch_guard" BEFORE UPDATE OR DELETE ON "FinanceBankMatch" FOR EACH ROW EXECUTE FUNCTION finance_bank_match_guard();
CREATE FUNCTION finance_bank_match_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NOT OLD.active OR NEW.active OR (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active')
 OR NOT EXISTS(SELECT 1 FROM "FinanceBankMatch" WHERE id=OLD."matchId" AND "reversedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Bank match entries are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatchEntry_guard" BEFORE UPDATE OR DELETE ON "FinanceBankMatchEntry" FOR EACH ROW EXECUTE FUNCTION finance_bank_match_entry_guard();
