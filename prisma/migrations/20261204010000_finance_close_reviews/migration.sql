-- AlterTable
ALTER TABLE "FinanceBook" ADD COLUMN     "closePolicy" JSONB;

-- CreateTable
CREATE TABLE "FinanceCloseReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "periodRevision" INTEGER NOT NULL,
    "policyHash" TEXT NOT NULL,
    "ledgerHash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "decisionEvidence" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCloseReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceCloseReview_organizationId_workspaceId_bookId_period_idx" ON "FinanceCloseReview"("organizationId", "workspaceId", "bookId", "periodId", "status");

-- AddForeignKey
ALTER TABLE "FinanceCloseReview" ADD CONSTRAINT "FinanceCloseReview_organizationId_workspaceId_bookId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId") REFERENCES "FinanceBook"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinanceCloseReview" ADD CONSTRAINT "FinanceCloseReview_organizationId_workspaceId_bookId_perio_fkey" FOREIGN KEY ("organizationId", "workspaceId", "bookId", "periodId") REFERENCES "FinancePeriod"("organizationId", "workspaceId", "bookId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "FinanceCloseReview" ADD CONSTRAINT "FinanceCloseReview_state_check" CHECK ("periodRevision">0 AND status IN ('PENDING','APPROVED','REJECTED') AND ((status='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "decisionEvidence" IS NULL) OR (status<>'PENDING' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"requestedBy" AND "reviewedAt" IS NOT NULL AND length(trim("decisionEvidence"))>0)));
CREATE FUNCTION finance_close_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Close review evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR (to_jsonb(NEW) - ARRAY['status','reviewedBy','reviewedAt','decisionEvidence']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reviewedBy','reviewedAt','decisionEvidence']) THEN
    RAISE EXCEPTION 'Close review evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "FinanceCloseReview_guard" BEFORE UPDATE OR DELETE ON "FinanceCloseReview" FOR EACH ROW EXECUTE FUNCTION finance_close_review_guard();
