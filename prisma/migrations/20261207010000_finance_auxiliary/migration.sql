-- CreateTable
CREATE TABLE "FinanceAuxiliaryType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAuxiliaryType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAuxiliaryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAuxiliaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSubjectAuxiliary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "policyReference" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceSubjectAuxiliary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVoucherAuxiliary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "typeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "FinanceVoucherAuxiliary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVoucherType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "policyReference" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceVoucherType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceVoucherProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucherTypeId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "FinanceVoucherProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAuxiliaryType_scope_key" ON "FinanceAuxiliaryType"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAuxiliaryType_code_key" ON "FinanceAuxiliaryType"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAuxiliaryItem_scope_key" ON "FinanceAuxiliaryItem"("organizationId", "workspaceId", "bookId", "typeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAuxiliaryItem_code_key" ON "FinanceAuxiliaryItem"("organizationId", "workspaceId", "bookId", "typeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSubjectAuxiliary_subject_type_key" ON "FinanceSubjectAuxiliary"("organizationId", "workspaceId", "bookId", "subjectId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherAuxiliary_line_type_key" ON "FinanceVoucherAuxiliary"("organizationId", "workspaceId", "voucherId", "lineNumber", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherType_scope_key" ON "FinanceVoucherType"("organizationId", "workspaceId", "bookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherType_code_key" ON "FinanceVoucherType"("organizationId", "workspaceId", "bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherProfile_voucher_key" ON "FinanceVoucherProfile"("organizationId", "workspaceId", "bookId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceVoucherLine_scoped_number_key" ON "FinanceVoucherLine"("organizationId", "workspaceId", "bookId", "voucherId", "lineNumber");

-- AddForeignKey
ALTER TABLE "FinanceAuxiliaryType" ADD CONSTRAINT "FinanceAuxiliaryType_book_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceAuxiliaryItem" ADD CONSTRAINT "FinanceAuxiliaryItem_type_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "typeId") REFERENCES "FinanceAuxiliaryType"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubjectAuxiliary" ADD CONSTRAINT "FinanceSubjectAuxiliary_type_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "typeId") REFERENCES "FinanceAuxiliaryType"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceSubjectAuxiliary" ADD CONSTRAINT "FinanceSubjectAuxiliary_subject_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "subjectId") REFERENCES "FinanceSubject"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherAuxiliary" ADD CONSTRAINT "FinanceVoucherAuxiliary_line_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "voucherId", "lineNumber") REFERENCES "FinanceVoucherLine"("organizationId", "workspaceId", "bookId", "voucherId", "lineNumber") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherAuxiliary" ADD CONSTRAINT "FinanceVoucherAuxiliary_item_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "typeId", "itemId") REFERENCES "FinanceAuxiliaryItem"("organizationId", "workspaceId", "bookId", "typeId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherType" ADD CONSTRAINT "FinanceVoucherType_book_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherProfile" ADD CONSTRAINT "FinanceVoucherProfile_voucher_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "voucherId") REFERENCES "FinanceVoucher"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceVoucherProfile" ADD CONSTRAINT "FinanceVoucherProfile_type_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "voucherTypeId") REFERENCES "FinanceVoucherType"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Catalog definitions are append-only: historical posted dimensions must retain their meaning.
CREATE FUNCTION finance_auxiliary_catalog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Finance auxiliary catalogs are immutable; add a new definition instead'; END $$;
CREATE TRIGGER "FinanceAuxiliaryType_guard" BEFORE UPDATE OR DELETE ON "FinanceAuxiliaryType" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceAuxiliaryItem_guard" BEFORE UPDATE OR DELETE ON "FinanceAuxiliaryItem" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceSubjectAuxiliary_guard" BEFORE UPDATE OR DELETE ON "FinanceSubjectAuxiliary" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FinanceVoucherType_guard" BEFORE UPDATE OR DELETE ON "FinanceVoucherType" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();

CREATE FUNCTION finance_auxiliary_annotation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v record;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace draft annotations with a revisioned command'; END IF;
  IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
  SELECT x.status,p.status AS period_status INTO v FROM "FinanceVoucher" x
    JOIN "FinancePeriod" p ON p.id=x."periodId" AND p."organizationId"=x."organizationId" AND p."workspaceId"=x."workspaceId" AND p."bookId"=x."bookId"
    WHERE x.id=r."voucherId" AND x."organizationId"=r."organizationId" AND x."workspaceId"=r."workspaceId" AND x."bookId"=r."bookId" FOR SHARE OF x,p;
  IF NOT FOUND OR v.status<>'DRAFT' OR v.period_status<>'OPEN' THEN RAISE EXCEPTION 'Annotations require an open-period draft'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "FinanceVoucherAuxiliary_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceVoucherAuxiliary" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_annotation_guard();
CREATE TRIGGER "FinanceVoucherProfile_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceVoucherProfile" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_annotation_guard();
