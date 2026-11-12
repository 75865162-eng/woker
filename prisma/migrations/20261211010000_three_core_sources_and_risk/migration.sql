CREATE TABLE "FinanceExternalSourceClaim" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"bookId" TEXT NOT NULL,"voucherId" TEXT NOT NULL,
 kind TEXT NOT NULL,"economicKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"sourceFingerprint" TEXT NOT NULL,currency TEXT NOT NULL,"sourceDate" DATE NOT NULL,"policyReference" TEXT NOT NULL,evidence TEXT NOT NULL,provenance JSONB NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceExternalSourceClaim_voucher_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","voucherId") REFERENCES "FinanceVoucher"("organizationId","workspaceId","bookId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FinanceExternalSourceClaim_economic_key" ON "FinanceExternalSourceClaim"("organizationId","workspaceId","economicKey");
CREATE INDEX "FinanceExternalSourceClaim_book_idx" ON "FinanceExternalSourceClaim"("organizationId","workspaceId","bookId","createdAt");
CREATE TRIGGER "FinanceExternalSourceClaim_guard" BEFORE UPDATE OR DELETE ON "FinanceExternalSourceClaim" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE UNIQUE INDEX "WmsAgingSnapshot_scope_key" ON "WmsAgingSnapshot"("organizationId","workspaceId",id);
CREATE TABLE "WmsInventoryRiskAssessment" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"snapshotId" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,policy JSONB NOT NULL,evidence JSONB NOT NULL,result JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',revision INTEGER NOT NULL DEFAULT 1,"createdBy" TEXT NOT NULL,"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"decisionEvidence" TEXT,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WmsInventoryRiskAssessment_snapshot_fkey" FOREIGN KEY ("organizationId","workspaceId","snapshotId") REFERENCES "WmsAgingSnapshot"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "WmsInventoryRiskAssessment_request_key" ON "WmsInventoryRiskAssessment"("organizationId","workspaceId","idempotencyKey");
CREATE INDEX "WmsInventoryRiskAssessment_snapshot_idx" ON "WmsInventoryRiskAssessment"("organizationId","workspaceId","snapshotId","createdAt");
CREATE FUNCTION wms_inventory_risk_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'DRAFT' OR NEW.status NOT IN ('REVIEWED','REJECTED') OR NEW.revision<>OLD.revision+1 OR NEW."reviewedBy" IS NULL OR NEW."reviewedBy"=OLD."createdBy" OR NEW."reviewedAt" IS NULL OR COALESCE(NEW."decisionEvidence",'')='' OR (to_jsonb(NEW)-ARRAY['status','revision','reviewedBy','reviewedAt','decisionEvidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','reviewedBy','reviewedAt','decisionEvidence']) THEN RAISE EXCEPTION 'Inventory risk evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WmsInventoryRiskAssessment_guard" BEFORE UPDATE OR DELETE ON "WmsInventoryRiskAssessment" FOR EACH ROW EXECUTE FUNCTION wms_inventory_risk_guard();
