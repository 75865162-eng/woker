CREATE TABLE "FbaRemoteExecutionPolicy" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"sellerAccountId" TEXT NOT NULL,"marketplaceId" TEXT NOT NULL,"authorizationId" TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT false,"allowedOperations" JSONB NOT NULL,"contractReference" TEXT NOT NULL,"expiresAt" TIMESTAMPTZ(3) NOT NULL,revision INTEGER NOT NULL DEFAULT 1,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organizationId","workspaceId") REFERENCES "WorkspaceScope"("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("organizationId","workspaceId","sellerAccountId") REFERENCES "SellerAccount"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("organizationId","workspaceId","authorizationId") REFERENCES "AmazonSpApiAuthorization"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaRemoteExecutionPolicy_scope_key" ON "FbaRemoteExecutionPolicy"("organizationId","workspaceId","sellerAccountId","marketplaceId");
CREATE UNIQUE INDEX "FbaRemoteExecutionPolicy_identity_key" ON "FbaRemoteExecutionPolicy"("organizationId","workspaceId",id);
CREATE TABLE "FbaRemotePlanBinding" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"externalPlanId" TEXT NOT NULL,"sourceReference" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaRemotePlanBinding_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "FbaRemotePlanBinding_plan_key" ON "FbaRemotePlanBinding"("organizationId","workspaceId","planId");
CREATE UNIQUE INDEX "FbaRemotePlanBinding_external_key" ON "FbaRemotePlanBinding"("organizationId","workspaceId","externalPlanId");
CREATE TRIGGER "FbaRemotePlanBinding_guard" BEFORE UPDATE OR DELETE ON "FbaRemotePlanBinding" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TABLE "FbaRemoteAction" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"policyId" TEXT NOT NULL,"policyRevision" INTEGER NOT NULL,"planRevision" INTEGER NOT NULL,"idempotencyKey" TEXT NOT NULL,operation TEXT NOT NULL,"requestMetadata" JSONB NOT NULL,"requestHash" TEXT NOT NULL,"requestCiphertext" TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',revision INTEGER NOT NULL DEFAULT 1,"createdBy" TEXT NOT NULL,"reviewedBy" TEXT,"reviewedAt" TIMESTAMPTZ(3),"reviewEvidence" TEXT,"operationId" TEXT,"externalEntityId" TEXT,"responseCiphertext" TEXT,"errorCode" TEXT,attempt INTEGER NOT NULL DEFAULT 0,"nextRunAt" TIMESTAMPTZ(3),"leaseToken" TEXT,"leaseExpiresAt" TIMESTAMPTZ(3),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "FbaRemoteAction_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("organizationId","workspaceId","policyId") REFERENCES "FbaRemoteExecutionPolicy"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK (status IN ('DRAFT','APPROVED','QUEUED','SENDING','WAITING','POLLING','SUCCEEDED','FAILED','RESULT_UNKNOWN','CANCELLED'))
);
CREATE UNIQUE INDEX "FbaRemoteAction_request_key" ON "FbaRemoteAction"("organizationId","workspaceId","planId","idempotencyKey");
CREATE INDEX "FbaRemoteAction_due_idx" ON "FbaRemoteAction"(status,"nextRunAt");
CREATE FUNCTION fba_remote_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','revision','reviewedBy','reviewedAt','reviewEvidence','operationId','externalEntityId','responseCiphertext','errorCode','attempt','nextRunAt','leaseToken','leaseExpiresAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','reviewedBy','reviewedAt','reviewEvidence','operationId','externalEntityId','responseCiphertext','errorCode','attempt','nextRunAt','leaseToken','leaseExpiresAt','updatedAt']) OR (OLD.status IN ('SUCCEEDED','FAILED','CANCELLED')) OR (OLD."externalEntityId" IS NOT NULL AND NEW."externalEntityId" IS DISTINCT FROM OLD."externalEntityId") OR NOT ((OLD.status='DRAFT' AND NEW.status IN ('APPROVED','CANCELLED')) OR (OLD.status='APPROVED' AND NEW.status IN ('QUEUED','CANCELLED')) OR (OLD.status='QUEUED' AND NEW.status IN ('SENDING','CANCELLED')) OR (OLD.status='SENDING' AND NEW.status IN ('SUCCEEDED','WAITING','FAILED','RESULT_UNKNOWN')) OR (OLD.status='WAITING' AND NEW.status='POLLING') OR (OLD.status='POLLING' AND NEW.status IN ('WAITING','SUCCEEDED','FAILED')) OR (OLD.status='RESULT_UNKNOWN' AND NEW.status='WAITING')) OR (OLD."operationId" IS NOT NULL AND NEW."operationId" IS DISTINCT FROM OLD."operationId") THEN RAISE EXCEPTION 'Remote request and terminal evidence are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FbaRemoteAction_guard" BEFORE UPDATE OR DELETE ON "FbaRemoteAction" FOR EACH ROW EXECUTE FUNCTION fba_remote_action_guard();
