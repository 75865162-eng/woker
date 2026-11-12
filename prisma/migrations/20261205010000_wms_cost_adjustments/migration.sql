-- CreateTable
CREATE TABLE "WmsCostAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "costEntryId" TEXT NOT NULL,
    "delta" DECIMAL(30,6) NOT NULL,
    "date" DATE NOT NULL,
    "policyReference" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "decisionEvidence" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WmsCostAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WmsCostAdjustment_organizationId_workspaceId_costEntryId_st_idx" ON "WmsCostAdjustment"("organizationId", "workspaceId", "costEntryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WmsCostAdjustment_organizationId_workspaceId_id_key" ON "WmsCostAdjustment"("organizationId", "workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WmsCostAdjustment_organizationId_workspaceId_idempotencyKey_key" ON "WmsCostAdjustment"("organizationId", "workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WmsCostEntry_organizationId_workspaceId_id_key" ON "WmsCostEntry"("organizationId", "workspaceId", "id");

-- AddForeignKey
ALTER TABLE "WmsCostAdjustment" ADD CONSTRAINT "WmsCostAdjustment_organizationId_workspaceId_costEntryId_fkey" FOREIGN KEY ("organizationId", "workspaceId", "costEntryId") REFERENCES "WmsCostEntry"("organizationId", "workspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "WmsCostAdjustment" ADD CONSTRAINT "WmsCostAdjustment_value_check" CHECK (delta<>0 AND revision>0 AND status IN ('DRAFT','REVIEWED','REJECTED') AND ((status='DRAFT' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "decisionEvidence" IS NULL) OR (status<>'DRAFT' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL AND length(trim("decisionEvidence"))>0)));
CREATE FUNCTION wms_cost_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cost adjustment evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' OR NEW.status='DRAFT' OR NEW.revision<>OLD.revision+1 OR (to_jsonb(NEW) - ARRAY['status','revision','reviewedBy','reviewedAt','decisionEvidence']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','revision','reviewedBy','reviewedAt','decisionEvidence']) THEN
    RAISE EXCEPTION 'Cost adjustment evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "WmsCostAdjustment_guard" BEFORE UPDATE OR DELETE ON "WmsCostAdjustment" FOR EACH ROW EXECUTE FUNCTION wms_cost_adjustment_guard();
