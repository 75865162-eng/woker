CREATE TABLE "FinanceFxRevaluation" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"bookId" TEXT NOT NULL,"periodId" TEXT NOT NULL,"sourceCurrency" TEXT NOT NULL,"reviewEvidence" TEXT,"rateId" TEXT NOT NULL,"policyReference" TEXT NOT NULL,evidence TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,items JSONB NOT NULL,calculation JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceFxRevaluation_period_fkey" FOREIGN KEY ("organizationId","workspaceId","bookId","periodId") REFERENCES "FinancePeriod"("organizationId","workspaceId","bookId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FinanceFxRevaluation_rate_fkey" FOREIGN KEY ("rateId") REFERENCES "FinanceExchangeRate"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FinanceFxRevaluation_request_key" ON "FinanceFxRevaluation"("organizationId","workspaceId","bookId","idempotencyKey");
CREATE INDEX "FinanceFxRevaluation_period_idx" ON "FinanceFxRevaluation"("organizationId","workspaceId","bookId","periodId");
CREATE UNIQUE INDEX "FinanceFxRevaluation_reviewed_key" ON "FinanceFxRevaluation"("organizationId","workspaceId","bookId","periodId","sourceCurrency") WHERE status='REVIEWED';
CREATE TABLE "FbaCustomsProfile" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"productRecordId" TEXT NOT NULL,"destinationCountry" TEXT NOT NULL,forwarder TEXT NOT NULL,version INTEGER NOT NULL,values JSONB NOT NULL,"sourceReference" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaCustomsProfile_product_fkey" FOREIGN KEY ("organizationId","workspaceId","productRecordId") REFERENCES "ProductRecord"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaCustomsProfile_version_key" ON "FbaCustomsProfile"("organizationId","workspaceId","productRecordId","destinationCountry",forwarder,version);
CREATE TABLE "FbaCustomsTemplate" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,code TEXT NOT NULL,version INTEGER NOT NULL,"destinationCountry" TEXT NOT NULL,forwarder TEXT NOT NULL,"schemaReference" TEXT NOT NULL,definition JSONB NOT NULL,"requestHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FbaCustomsTemplate_scope_key" ON "FbaCustomsTemplate"("organizationId","workspaceId",id);
CREATE UNIQUE INDEX "FbaCustomsTemplate_version_key" ON "FbaCustomsTemplate"("organizationId","workspaceId",code,version);
CREATE UNIQUE INDEX "FbaLocalCustomsDeclaration_identity_key" ON "FbaLocalCustomsDeclaration"("organizationId","workspaceId",id);
CREATE TABLE "FbaCustomsExport" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"declarationId" TEXT NOT NULL,"templateId" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,xml TEXT NOT NULL,"xmlHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaCustomsExport_declaration_fkey" FOREIGN KEY ("organizationId","workspaceId","declarationId") REFERENCES "FbaLocalCustomsDeclaration"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaCustomsExport_template_fkey" FOREIGN KEY ("organizationId","workspaceId","templateId") REFERENCES "FbaCustomsTemplate"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaCustomsExport_request_key" ON "FbaCustomsExport"("organizationId","workspaceId","idempotencyKey");
CREATE FUNCTION three_core_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'DRAFT' OR NEW.status NOT IN ('ACTIVE','REVIEWED') OR NEW."reviewedBy" IS NULL OR NEW."reviewedBy"=OLD."createdBy" OR NEW."reviewedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['status','reviewedBy','reviewedAt','reviewEvidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewedBy','reviewedAt','reviewEvidence']) OR (TG_TABLE_NAME='FinanceFxRevaluation' AND COALESCE(to_jsonb(NEW)->>'reviewEvidence','')='') THEN RAISE EXCEPTION 'Reviewed evidence cannot be overwritten'; END IF;RETURN NEW;END $$;
CREATE FUNCTION finance_fx_revaluation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Revaluation evidence cannot be deleted'; END IF;
 IF NEW."reviewedBy" IS NULL OR NEW."reviewedAt" IS NULL OR COALESCE(NEW."reviewEvidence",'')='' OR (to_jsonb(NEW)-ARRAY['status','reviewedBy','reviewedAt','reviewEvidence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewedBy','reviewedAt','reviewEvidence']) THEN RAISE EXCEPTION 'Revaluation evidence cannot be overwritten'; END IF;
 IF NOT ((OLD.status='DRAFT' AND NEW.status='REVIEWED' AND NEW."reviewedBy"<>OLD."createdBy") OR (OLD.status IN ('DRAFT','NEEDS_DATA') AND NEW.status='CANCELLED' AND NEW."reviewedBy"=OLD."createdBy")) THEN RAISE EXCEPTION 'Invalid revaluation transition'; END IF;
 RETURN NEW;END $$;
CREATE TRIGGER "FinanceFxRevaluation_guard" BEFORE UPDATE OR DELETE ON "FinanceFxRevaluation" FOR EACH ROW EXECUTE FUNCTION finance_fx_revaluation_guard();
CREATE TRIGGER "FbaCustomsProfile_guard" BEFORE UPDATE OR DELETE ON "FbaCustomsProfile" FOR EACH ROW EXECUTE FUNCTION three_core_review_guard();
CREATE TRIGGER "FbaCustomsTemplate_guard" BEFORE UPDATE OR DELETE ON "FbaCustomsTemplate" FOR EACH ROW EXECUTE FUNCTION three_core_review_guard();
CREATE TRIGGER "FbaCustomsExport_guard" BEFORE UPDATE OR DELETE ON "FbaCustomsExport" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
