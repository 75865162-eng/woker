CREATE TABLE "FinanceOpenItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "counterparty" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(30,6) NOT NULL,
  "dueDate" DATE NOT NULL,
  "evidence" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceOpenItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceOpenItem_kind_check" CHECK ("kind" IN ('PAYABLE','RECEIVABLE','PAYMENT','RECEIPT')),
  CONSTRAINT "FinanceOpenItem_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "FinanceOpenItem_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "FinanceOpenItem_status_check" CHECK ("status" IN ('OPEN','VOIDED')),
  CONSTRAINT "FinanceOpenItem_organizationId_workspaceId_bookId_id_key" UNIQUE ("organizationId","workspaceId","bookId","id"),
  CONSTRAINT "FinanceOpenItem_organizationId_workspaceId_voucherId_subjectId_key" UNIQUE ("organizationId","workspaceId","voucherId","subjectId"),
  CONSTRAINT "FinanceOpenItem_book_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId") REFERENCES "FinanceBook"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceOpenItem_voucher_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","voucherId") REFERENCES "FinanceVoucher"("organizationId","workspaceId","bookId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceOpenItem_subject_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","subjectId") REFERENCES "FinanceSubject"("organizationId","workspaceId","bookId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceOpenItem_workspace_fkey" FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "FinanceOpenItem_organizationId_workspaceId_bookId_counterparty_dueDate_idx" ON "FinanceOpenItem"("organizationId","workspaceId","bookId","counterparty","dueDate");

CREATE TABLE "FinanceSettlement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "amount" DECIMAL(30,6) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "reversedBy" TEXT,
  "reversedAt" TIMESTAMPTZ(3),
  "reversalEvidence" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceSettlement_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "FinanceSettlement_reversal_check" CHECK (("reversedBy" IS NULL AND "reversedAt" IS NULL AND "reversalEvidence" IS NULL) OR ("reversedBy" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversalEvidence" IS NOT NULL)),
  CONSTRAINT "FinanceSettlement_organizationId_workspaceId_bookId_idempotencyKey_key" UNIQUE ("organizationId","workspaceId","bookId","idempotencyKey"),
  CONSTRAINT "FinanceSettlement_book_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId") REFERENCES "FinanceBook"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceSettlement_period_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","periodId") REFERENCES "FinancePeriod"("organizationId","workspaceId","bookId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceSettlement_document_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","documentId") REFERENCES "FinanceOpenItem"("organizationId","workspaceId","bookId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceSettlement_payment_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","paymentId") REFERENCES "FinanceOpenItem"("organizationId","workspaceId","bookId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "FinanceSettlement_workspace_fkey" FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "FinanceSettlement_organizationId_workspaceId_bookId_documentId_reversedAt_idx" ON "FinanceSettlement"("organizationId","workspaceId","bookId","documentId","reversedAt");
CREATE INDEX "FinanceSettlement_organizationId_workspaceId_bookId_paymentId_reversedAt_idx" ON "FinanceSettlement"("organizationId","workspaceId","bookId","paymentId","reversedAt");

CREATE FUNCTION finance_open_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Finance open items cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF ROW(NEW."id",NEW."organizationId",NEW."workspaceId",NEW."bookId",NEW."voucherId",NEW."subjectId",NEW."counterparty",NEW."kind",NEW."currency",NEW."amount",NEW."dueDate",NEW."evidence",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."organizationId",OLD."workspaceId",OLD."bookId",OLD."voucherId",OLD."subjectId",OLD."counterparty",OLD."kind",OLD."currency",OLD."amount",OLD."dueDate",OLD."evidence",OLD."createdBy",OLD."createdAt") THEN
    RAISE EXCEPTION 'Finance open item evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'OPEN' OR NEW."status" <> 'VOIDED' OR NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'Finance open item can only be voided once with a revision increment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceOpenItem_guard" BEFORE UPDATE OR DELETE ON "FinanceOpenItem" FOR EACH ROW EXECUTE FUNCTION finance_open_item_guard();

CREATE FUNCTION finance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Finance settlements cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF ROW(NEW."id",NEW."organizationId",NEW."workspaceId",NEW."bookId",NEW."documentId",NEW."paymentId",NEW."periodId",NEW."date",NEW."amount",NEW."idempotencyKey",NEW."requestHash",NEW."evidence",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."organizationId",OLD."workspaceId",OLD."bookId",OLD."documentId",OLD."paymentId",OLD."periodId",OLD."date",OLD."amount",OLD."idempotencyKey",OLD."requestHash",OLD."evidence",OLD."createdBy",OLD."createdAt") THEN
    RAISE EXCEPTION 'Finance settlement identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."reversedAt" IS NOT NULL OR NEW."reversedAt" IS NULL OR NEW."reversedBy" IS NULL OR NEW."reversalEvidence" IS NULL THEN
    RAISE EXCEPTION 'Finance settlement reversal must be recorded once with evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceSettlement_guard" BEFORE UPDATE OR DELETE ON "FinanceSettlement" FOR EACH ROW EXECUTE FUNCTION finance_settlement_guard();
