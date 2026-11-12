-- CreateTable
CREATE TABLE "FinanceReportTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "policyReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceReportTemplate_organizationId_workspaceId_bookId_sta_idx" ON "FinanceReportTemplate"("organizationId", "workspaceId", "bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceReportTemplate_organizationId_workspaceId_bookId_cod_key" ON "FinanceReportTemplate"("organizationId", "workspaceId", "bookId", "code", "version");

-- AddForeignKey
ALTER TABLE "FinanceReportTemplate" ADD CONSTRAINT "FinanceReportTemplate_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "FinanceReportTemplate" ADD CONSTRAINT "FinanceReportTemplate_state_check" CHECK (version>0 AND kind IN ('BALANCE_SHEET','PROFIT_LOSS','CUSTOM') AND status IN ('DRAFT','ACTIVE') AND ((status='DRAFT' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL) OR (status='ACTIVE' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL)));
CREATE FUNCTION finance_report_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Report template evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' OR NEW.status<>'ACTIVE' OR (to_jsonb(NEW) - ARRAY['status','reviewedBy','reviewedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reviewedBy','reviewedAt']) THEN
    RAISE EXCEPTION 'Report template identity is immutable; create a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "FinanceReportTemplate_guard" BEFORE UPDATE OR DELETE ON "FinanceReportTemplate" FOR EACH ROW EXECUTE FUNCTION finance_report_template_guard();
