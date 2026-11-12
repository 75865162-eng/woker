-- CreateTable
CREATE TABLE "FinanceBook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinanceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinancePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSubject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalSide" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "leaf" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinanceSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceOpeningBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "amount" DECIMAL(30,6) NOT NULL,
    "side" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVoucher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT NOT NULL DEFAULT 'STANDARD',
    "reversalOf" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "postedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "postedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinanceVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVoucherLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "debit" DECIMAL(30,6) NOT NULL,
    "credit" DECIMAL(30,6) NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FinanceVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceBook_organizationId_workspaceId_enabled_code_idx" ON "FinanceBook"("organizationId", "workspaceId", "enabled", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBook_organizationId_workspaceId_id_key" ON "FinanceBook"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceBook_organizationId_workspaceId_code_key" ON "FinanceBook"("organizationId", "workspaceId", "code");

-- CreateIndex
CREATE INDEX "FinancePeriod_organizationId_workspaceId_bookId_start_end_idx" ON "FinancePeriod"("organizationId", "workspaceId", "bookId", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePeriod_organizationId_workspaceId_id_key" ON "FinancePeriod"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePeriod_organizationId_workspaceId_bookId_code_key" ON "FinancePeriod"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE INDEX "FinanceSubject_organizationId_workspaceId_bookId_enabled_co_idx" ON "FinanceSubject"("organizationId", "workspaceId", "bookId", "enabled", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubject_organizationId_workspaceId_id_key" ON "FinanceSubject"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubject_organizationId_workspaceId_bookId_code_key" ON "FinanceSubject"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubject_organizationId_workspaceId_bookId_id_key" ON "FinanceSubject"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE INDEX "FinanceOpeningBalance_organizationId_workspaceId_bookId_per_idx" ON "FinanceOpeningBalance"("organizationId", "workspaceId", "bookId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceOpeningBalance_organizationId_workspaceId_periodId_s_key" ON "FinanceOpeningBalance"("organizationId", "workspaceId", "periodId", "subjectId");

-- CreateIndex
CREATE INDEX "FinanceVoucher_organizationId_workspaceId_bookId_periodId_d_idx" ON "FinanceVoucher"("organizationId", "workspaceId", "bookId", "periodId", "date", "id");

-- CreateIndex
CREATE INDEX "FinanceVoucher_organizationId_workspaceId_bookId_status_dat_idx" ON "FinanceVoucher"("organizationId", "workspaceId", "bookId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucher_organizationId_workspaceId_id_key" ON "FinanceVoucher"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucher_organizationId_workspaceId_bookId_id_key" ON "FinanceVoucher"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucher_organizationId_workspaceId_bookId_sourceKey_key" ON "FinanceVoucher"("organizationId", "workspaceId", "bookId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucher_organizationId_workspaceId_bookId_idempotenc_key" ON "FinanceVoucher"("organizationId", "workspaceId", "bookId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FinanceVoucherLine_organizationId_workspaceId_bookId_subjec_idx" ON "FinanceVoucherLine"("organizationId", "workspaceId", "bookId", "subjectId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherLine_organizationId_workspaceId_voucherId_lin_key" ON "FinanceVoucherLine"("organizationId", "workspaceId", "voucherId", "lineNumber");

-- AddForeignKey
ALTER TABLE "FinanceBook" ADD CONSTRAINT "FinanceBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBook" ADD CONSTRAINT "FinanceBook_organizationId_workspaceId_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceBook" ADD CONSTRAINT "FinanceBook_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePeriod" ADD CONSTRAINT "FinancePeriod_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubject" ADD CONSTRAINT "FinanceSubject_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubject" ADD CONSTRAINT "FinanceSubject_organizationId_workspaceId_bookId_parentId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "parentId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceOpeningBalance" ADD CONSTRAINT "FinanceOpeningBalance_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceOpeningBalance" ADD CONSTRAINT "FinanceOpeningBalance_organizationId_workspaceId_periodId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "periodId") REFERENCES "FinancePeriod"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceOpeningBalance" ADD CONSTRAINT "FinanceOpeningBalance_organizationId_workspaceId_bookId_su_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "subjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_organizationId_workspaceId_periodId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "periodId") REFERENCES "FinancePeriod"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_organizationId_workspaceId_bookId_reversalO_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "reversalOf") REFERENCES "FinanceVoucher"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherLine" ADD CONSTRAINT "FinanceVoucherLine_organizationId_workspaceId_bookId_vouch_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "voucherId") REFERENCES "FinanceVoucher"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherLine" ADD CONSTRAINT "FinanceVoucherLine_organizationId_workspaceId_bookId_subje_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "subjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "FinanceBook" ADD CONSTRAINT "FinanceBook_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "FinanceBook" ADD CONSTRAINT "FinanceBook_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinancePeriod" ADD CONSTRAINT "FinancePeriod_range_check" CHECK ("start" <= "end");
ALTER TABLE "FinancePeriod" ADD CONSTRAINT "FinancePeriod_status_check" CHECK ("status" IN ('NOT_OPEN', 'OPEN', 'CLOSED'));
ALTER TABLE "FinancePeriod" ADD CONSTRAINT "FinancePeriod_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinanceSubject" ADD CONSTRAINT "FinanceSubject_side_check" CHECK ("normalSide" IN ('DEBIT', 'CREDIT'));
ALTER TABLE "FinanceSubject" ADD CONSTRAINT "FinanceSubject_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinanceOpeningBalance" ADD CONSTRAINT "FinanceOpeningBalance_value_check" CHECK ("amount" >= 0 AND "side" IN ('DEBIT', 'CREDIT'));
ALTER TABLE "FinanceOpeningBalance" ADD CONSTRAINT "FinanceOpeningBalance_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_source_check" CHECK (length(trim("sourceKey")) > 0);
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_status_check" CHECK ("status" IN ('DRAFT', 'REVIEWED', 'POSTED'));
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_kind_check" CHECK ("kind" IN ('STANDARD', 'REVERSAL'));
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_revision_check" CHECK ("revision" > 0);
ALTER TABLE "FinanceVoucher" ADD CONSTRAINT "FinanceVoucher_reversal_check" CHECK (("kind" = 'STANDARD' AND "reversalOf" IS NULL) OR ("kind" = 'REVERSAL' AND "reversalOf" IS NOT NULL AND "reversalOf" <> "id"));
ALTER TABLE "FinanceVoucherLine" ADD CONSTRAINT "FinanceVoucherLine_amount_check" CHECK (("debit" = 0) <> ("credit" = 0));
ALTER TABLE "FinanceVoucherLine" ADD CONSTRAINT "FinanceVoucherLine_number_check" CHECK ("lineNumber" > 0);

CREATE FUNCTION finance_voucher_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Finance voucher evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted finance vouchers are immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."organizationId", NEW."workspaceId", NEW."bookId", NEW."periodId", NEW."sourceKey", NEW."idempotencyKey", NEW."requestHash", NEW."date", NEW."memo", NEW."kind", NEW."reversalOf", NEW."createdBy") IS DISTINCT FROM ROW(OLD."organizationId", OLD."workspaceId", OLD."bookId", OLD."periodId", OLD."sourceKey", OLD."idempotencyKey", OLD."requestHash", OLD."date", OLD."memo", OLD."kind", OLD."reversalOf", OLD."createdBy") THEN
    RAISE EXCEPTION 'Finance voucher identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'REVIEWED')) OR (OLD."status" = 'REVIEWED' AND NEW."status" NOT IN ('REVIEWED', 'POSTED')) THEN
    RAISE EXCEPTION 'Invalid finance voucher transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceVoucher_guard" BEFORE UPDATE OR DELETE ON "FinanceVoucher" FOR EACH ROW EXECUTE FUNCTION finance_voucher_guard();

CREATE FUNCTION finance_voucher_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status TEXT;
  parent_kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."organizationId", NEW."workspaceId", NEW."bookId", NEW."voucherId") IS DISTINCT FROM ROW(OLD."organizationId", OLD."workspaceId", OLD."bookId", OLD."voucherId") THEN
      RAISE EXCEPTION 'Finance voucher line identity is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT "status", "kind" INTO parent_status, parent_kind FROM "FinanceVoucher"
    WHERE "organizationId" = OLD."organizationId" AND "workspaceId" = OLD."workspaceId" AND "bookId" = OLD."bookId" AND "id" = OLD."voucherId" FOR UPDATE;
  ELSE
    SELECT "status", "kind" INTO parent_status, parent_kind FROM "FinanceVoucher"
    WHERE "organizationId" = NEW."organizationId" AND "workspaceId" = NEW."workspaceId" AND "bookId" = NEW."bookId" AND "id" = NEW."voucherId" FOR UPDATE;
  END IF;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Reviewed or posted finance voucher lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF (parent_kind = 'STANDARD' AND (NEW."debit" < 0 OR NEW."credit" < 0))
      OR (parent_kind = 'REVERSAL' AND (NEW."debit" > 0 OR NEW."credit" > 0)) THEN
      RAISE EXCEPTION 'Finance voucher line sign does not match voucher kind' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceVoucherLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceVoucherLine" FOR EACH ROW EXECUTE FUNCTION finance_voucher_line_guard();

CREATE FUNCTION finance_opening_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posted_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Finance opening balances cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO posted_count FROM "FinanceVoucher" WHERE "organizationId"=NEW."organizationId" AND "workspaceId"=NEW."workspaceId" AND "bookId"=NEW."bookId" AND "periodId"=NEW."periodId" AND "status"='POSTED';
  IF posted_count > 0 THEN
    RAISE EXCEPTION 'Opening balances cannot change after posting' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinanceOpeningBalance_guard" BEFORE UPDATE OR DELETE ON "FinanceOpeningBalance" FOR EACH ROW EXECUTE FUNCTION finance_opening_balance_guard();
