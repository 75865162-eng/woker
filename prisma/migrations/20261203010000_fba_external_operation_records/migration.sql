-- CreateTable
CREATE TABLE "FbaExternalOperationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "operationName" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "requestId" TEXT,
    "operationId" TEXT,
    "entityId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESULT_UNKNOWN',
    "resolutionEvidence" TEXT,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FbaExternalOperationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FbaExternalOperationRecord_organizationId_workspaceId_planI_idx" ON "FbaExternalOperationRecord"("organizationId", "workspaceId", "planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FbaExternalOperationRecord_organizationId_workspaceId_planI_key" ON "FbaExternalOperationRecord"("organizationId", "workspaceId", "planId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "FbaExternalOperationRecord" ADD CONSTRAINT "FbaExternalOperationRecord_organizationId_workspaceId_plan_fkey" FOREIGN KEY ("organizationId", "workspaceId", "planId") REFERENCES "FbaLocalPlan"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "FbaExternalOperationRecord" ADD CONSTRAINT "FbaExternalOperationRecord_state_check" CHECK ("planRevision">0 AND "apiVersion"='2024-03-20' AND "requestDigest" ~ '^[a-f0-9]{64}$' AND step IN ('PLAN','PACKING','PLACEMENT','TRANSPORT','DELIVERY_WINDOW','LABELS','SHIPMENT_CONFIRMATION','CANCELLATION') AND status IN ('RESULT_UNKNOWN','REVIEWED_SUCCEEDED','REVIEWED_FAILED') AND ((status='RESULT_UNKNOWN' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "resolutionEvidence" IS NULL) OR (status<>'RESULT_UNKNOWN' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL AND length(trim("resolutionEvidence"))>0)));
CREATE UNIQUE INDEX "FbaExternalOperationRecord_unresolved_step" ON "FbaExternalOperationRecord"("organizationId","workspaceId","planId",step) WHERE status='RESULT_UNKNOWN';
CREATE FUNCTION fba_external_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'External operation evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'RESULT_UNKNOWN' OR NEW.status='RESULT_UNKNOWN' OR (to_jsonb(NEW) - ARRAY['status','reviewedBy','reviewedAt','resolutionEvidence','operationId','entityId']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reviewedBy','reviewedAt','resolutionEvidence','operationId','entityId']) OR (OLD."operationId" IS NOT NULL AND NEW."operationId" IS DISTINCT FROM OLD."operationId") OR (OLD."entityId" IS NOT NULL AND NEW."entityId" IS DISTINCT FROM OLD."entityId") THEN
    RAISE EXCEPTION 'External operation identity and reviewed evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "FbaExternalOperationRecord_guard" BEFORE UPDATE OR DELETE ON "FbaExternalOperationRecord" FOR EACH ROW EXECUTE FUNCTION fba_external_record_guard();
