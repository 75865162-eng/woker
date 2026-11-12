ALTER TABLE "FinanceSubjectCategory" ADD COLUMN level INTEGER NOT NULL DEFAULT 1, ADD COLUMN "isFixed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FinanceBankAccount" ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'UNSPECIFIED', ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FinanceAuxiliaryItem" ADD COLUMN "isFixed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true, ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "FinanceBankAccount_default_key" ON "FinanceBankAccount"("organizationId","workspaceId","bookId") WHERE "isDefault"=true AND enabled=true;
CREATE UNIQUE INDEX "FbaRemoteAction_identity_key" ON "FbaRemoteAction"("organizationId","workspaceId",id);
CREATE TABLE "FbaRemoteReadSnapshot" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"actionId" TEXT NOT NULL,operation TEXT NOT NULL,"externalPlanId" TEXT NOT NULL,"shipmentId" TEXT,"capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"sourceHash" TEXT NOT NULL,"pageComplete" BOOLEAN NOT NULL,"continuationTokenPresent" BOOLEAN NOT NULL,normalized JSONB NOT NULL,
 CONSTRAINT "FbaRemoteReadSnapshot_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaRemoteReadSnapshot_action_fkey" FOREIGN KEY ("organizationId","workspaceId","actionId") REFERENCES "FbaRemoteAction"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaRemoteReadSnapshot_action_key" ON "FbaRemoteReadSnapshot"("organizationId","workspaceId","actionId");
CREATE INDEX "FbaRemoteReadSnapshot_plan_idx" ON "FbaRemoteReadSnapshot"("organizationId","workspaceId","planId","capturedAt");
CREATE TRIGGER "FbaRemoteReadSnapshot_guard" BEFORE UPDATE OR DELETE ON "FbaRemoteReadSnapshot" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TABLE "WmsOverseasCharge" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"manifestId" TEXT NOT NULL,number TEXT NOT NULL,currency TEXT NOT NULL,amount DECIMAL(30,6) NOT NULL,"allocationMethod" TEXT NOT NULL,reference TEXT NOT NULL,evidence TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,allocation JSONB NOT NULL,"createdBy" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WmsOverseasCharge_manifest_fkey" FOREIGN KEY ("organizationId","workspaceId","manifestId") REFERENCES "WmsOverseasManifest"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("allocationMethod" IN ('QUANTITY','WEIGHT','VOLUME','VALUE')), CHECK (status IN ('DRAFT','REVIEWED')), CHECK (amount>=0)
);
CREATE UNIQUE INDEX "WmsOverseasCharge_request_key" ON "WmsOverseasCharge"("organizationId","workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "WmsOverseasCharge_number_key" ON "WmsOverseasCharge"("organizationId","workspaceId","manifestId",number);
CREATE FUNCTION wms_overseas_charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'DRAFT' OR NEW.status<>'REVIEWED' OR NEW."reviewedBy" IS NULL OR NEW."reviewedBy"=OLD."createdBy" OR NEW."reviewedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['status','reviewedBy','reviewedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewedBy','reviewedAt']) THEN RAISE EXCEPTION 'Overseas charge evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WmsOverseasCharge_guard" BEFORE UPDATE OR DELETE ON "WmsOverseasCharge" FOR EACH ROW EXECUTE FUNCTION wms_overseas_charge_guard();

-- Mutable catalog presentation/status; identities and historical posting evidence stay fixed.
CREATE FUNCTION finance_catalog_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='FinanceBankAccount' OR COALESCE(to_jsonb(OLD)->>'isFixed','false')='true' THEN RAISE EXCEPTION 'Fixed/financial account evidence cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Catalog revision must advance'; END IF;
 IF TG_TABLE_NAME='FinanceBankAccount' THEN
  IF (to_jsonb(NEW)-ARRAY['name','maskedNumber','paymentMethod','enabled','isDefault','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','maskedNumber','paymentMethod','enabled','isDefault','revision']) OR (NEW."isDefault" AND NOT NEW.enabled) THEN RAISE EXCEPTION 'Account identity immutable'; END IF;
 ELSE
  IF COALESCE(to_jsonb(OLD)->>'isFixed','false')='true' AND NEW.name<>OLD.name THEN RAISE EXCEPTION 'Fixed catalog name immutable'; END IF;
  IF (to_jsonb(NEW)-ARRAY['name','sortOrder','enabled','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','sortOrder','enabled','revision']) THEN RAISE EXCEPTION 'Catalog identity immutable'; END IF;
 END IF;
 RETURN NEW;END $$;
DROP TRIGGER "FinanceSubjectCategory_guard" ON "FinanceSubjectCategory";
DROP TRIGGER "FinanceBankAccount_guard" ON "FinanceBankAccount";
DROP TRIGGER "FinanceAuxiliaryItem_guard" ON "FinanceAuxiliaryItem";
-- BEGIN FINANCE_CATEGORY_LEVEL_BACKFILL
DO $$ DECLARE total_count bigint; reachable_count bigint; deepest integer; BEGIN
 SELECT COUNT(*) INTO total_count FROM "FinanceSubjectCategory";
 WITH RECURSIVE tree AS (SELECT id,1 AS depth FROM "FinanceSubjectCategory" WHERE "parentId" IS NULL UNION ALL SELECT child.id,tree.depth+1 FROM "FinanceSubjectCategory" child JOIN tree ON child."parentId"=tree.id WHERE tree.depth<=3)
 SELECT COUNT(*),MAX(depth) INTO reachable_count,deepest FROM tree;
 IF reachable_count<>total_count OR COALESCE(deepest,0)>3 THEN RAISE EXCEPTION 'Existing finance category tree is cyclic, orphaned or deeper than three levels; reconcile target hierarchy before migration'; END IF;
 WITH RECURSIVE tree AS (SELECT id,1 AS depth FROM "FinanceSubjectCategory" WHERE "parentId" IS NULL UNION ALL SELECT child.id,tree.depth+1 FROM "FinanceSubjectCategory" child JOIN tree ON child."parentId"=tree.id)
 UPDATE "FinanceSubjectCategory" category SET level=tree.depth FROM tree WHERE category.id=tree.id;
END $$;
-- END FINANCE_CATEGORY_LEVEL_BACKFILL
CREATE TRIGGER "FinanceSubjectCategory_guard" BEFORE UPDATE OR DELETE ON "FinanceSubjectCategory" FOR EACH ROW EXECUTE FUNCTION finance_catalog_lifecycle_guard();
CREATE TRIGGER "FinanceBankAccount_guard" BEFORE UPDATE OR DELETE ON "FinanceBankAccount" FOR EACH ROW EXECUTE FUNCTION finance_catalog_lifecycle_guard();
CREATE TRIGGER "FinanceAuxiliaryItem_guard" BEFORE UPDATE OR DELETE ON "FinanceAuxiliaryItem" FOR EACH ROW EXECUTE FUNCTION finance_catalog_lifecycle_guard();
ALTER TABLE "FinanceSubjectCategory" ADD CONSTRAINT "FinanceSubjectCategory_level_check" CHECK (level BETWEEN 1 AND 3);
ALTER TABLE "FinanceReportTemplate" DROP CONSTRAINT "FinanceReportTemplate_state_check";
ALTER TABLE "FinanceReportTemplate" ADD CONSTRAINT "FinanceReportTemplate_state_check" CHECK (version>0 AND kind IN ('BALANCE_SHEET','PROFIT_LOSS','CUSTOM','VOUCHER_MAPPING') AND status IN ('DRAFT','ACTIVE') AND ((status='DRAFT' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL) OR (status='ACTIVE' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL)));
