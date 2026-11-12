CREATE TABLE "FinanceExpense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "amount" DECIMAL(30,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "debitSubjectId" TEXT NOT NULL,
    "creditSubjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "decisionMemo" TEXT NOT NULL DEFAULT '',
    "financeVoucherId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FinanceExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceExpense_organizationId_workspaceId_id_key" ON "FinanceExpense"("organizationId", "workspaceId", "id");
CREATE UNIQUE INDEX "FinanceExpense_organizationId_workspaceId_number_key" ON "FinanceExpense"("organizationId", "workspaceId", "number");
CREATE UNIQUE INDEX "FinanceExpense_organizationId_workspaceId_financeVoucherId_key" ON "FinanceExpense"("organizationId", "workspaceId", "financeVoucherId");
CREATE UNIQUE INDEX "FinancePeriod_organizationId_workspaceId_bookId_id_key" ON "FinancePeriod"("organizationId", "workspaceId", "bookId", "id");
CREATE INDEX "FinanceExpense_organizationId_workspaceId_status_expenseDate_id_idx" ON "FinanceExpense"("organizationId", "workspaceId", "status", "expenseDate", "id");
CREATE INDEX "FinanceExpense_organizationId_workspaceId_bookId_periodId_status_idx" ON "FinanceExpense"("organizationId", "workspaceId", "bookId", "periodId", "status");

ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_amount_check" CHECK ("amount" > 0);
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_subjects_check" CHECK ("debitSubjectId" <> "creditSubjectId");
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_required_text_check" CHECK (length(trim("number")) > 0 AND length(trim("category")) > 0 AND length(trim("payee")) > 0 AND length(trim("description")) > 0);

ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_book_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_period_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "periodId") REFERENCES "FinancePeriod"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_debitSubject_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "debitSubjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_creditSubject_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "creditSubjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_voucher_fkey" FOREIGN KEY ("organizationId", "workspaceId", "financeVoucherId") REFERENCES "FinanceVoucher"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION finance_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Finance expense evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."organizationId", NEW."workspaceId", NEW."createdBy") IS DISTINCT FROM ROW(OLD."organizationId", OLD."workspaceId", OLD."createdBy") THEN
    RAISE EXCEPTION 'Finance expense identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."reviewedBy" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."financeVoucherId" IS NOT NULL OR NEW."decisionMemo" <> '' THEN
      RAISE EXCEPTION 'Finance expense draft edit evidence is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW."number", NEW."category", NEW."payee", NEW."description", NEW."expenseDate", NEW."amount", NEW."currency", NEW."bookId", NEW."periodId", NEW."debitSubjectId", NEW."creditSubjectId") IS DISTINCT FROM ROW(OLD."number", OLD."category", OLD."payee", OLD."description", OLD."expenseDate", OLD."amount", OLD."currency", OLD."bookId", OLD."periodId", OLD."debitSubjectId", OLD."creditSubjectId") THEN
    RAISE EXCEPTION 'Submitted finance expense fields are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED' THEN
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."reviewedBy" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."financeVoucherId" IS NOT NULL OR NEW."decisionMemo" <> '' THEN
      RAISE EXCEPTION 'Finance expense submission evidence is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED') THEN
    IF NEW."revision" <> OLD."revision" + 1 OR NEW."reviewedBy" IS NULL OR NEW."reviewedBy" = NEW."createdBy" OR NEW."reviewedAt" IS NULL OR (NEW."status" = 'APPROVED' AND NEW."financeVoucherId" IS NULL) OR (NEW."status" = 'REJECTED' AND (NEW."financeVoucherId" IS NOT NULL OR length(trim(NEW."decisionMemo")) = 0)) THEN
      RAISE EXCEPTION 'Finance expense decision evidence is incomplete' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid finance expense transition' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "FinanceExpense_guard" BEFORE UPDATE OR DELETE ON "FinanceExpense" FOR EACH ROW EXECUTE FUNCTION finance_expense_guard();
