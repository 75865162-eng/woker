CREATE TABLE "FbaWorkflowOptionSnapshot" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"planId" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('PACKING','PLACEMENT','TRANSPORTATION','DELIVERY_WINDOW')),
 "externalPlanId" TEXT NOT NULL,"operationId" TEXT NOT NULL,"capturedAt" TIMESTAMPTZ(3) NOT NULL,"expiresAt" TIMESTAMPTZ(3) NOT NULL,
 evidence TEXT NOT NULL,options JSONB NOT NULL,"sourceHash" TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaWorkflowOptionSnapshot_plan_fkey" FOREIGN KEY ("organizationId","workspaceId","planId") REFERENCES "FbaLocalPlan"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("expiresAt">"capturedAt")
);
CREATE UNIQUE INDEX "FbaWorkflowOptionSnapshot_scope_key" ON "FbaWorkflowOptionSnapshot"("organizationId","workspaceId",id);
CREATE UNIQUE INDEX "FbaWorkflowOptionSnapshot_request_key" ON "FbaWorkflowOptionSnapshot"("organizationId","workspaceId","planId","idempotencyKey");
CREATE TABLE "FbaWorkflowOptionSelection" (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"snapshotId" TEXT NOT NULL UNIQUE,"optionId" TEXT NOT NULL,evidence TEXT NOT NULL,"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaWorkflowOptionSelection_snapshot_fkey" FOREIGN KEY ("organizationId","workspaceId","snapshotId") REFERENCES "FbaWorkflowOptionSnapshot"("organizationId","workspaceId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TRIGGER "FbaWorkflowOptionSnapshot_guard" BEFORE UPDATE OR DELETE ON "FbaWorkflowOptionSnapshot" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();
CREATE TRIGGER "FbaWorkflowOptionSelection_guard" BEFORE UPDATE OR DELETE ON "FbaWorkflowOptionSelection" FOR EACH ROW EXECUTE FUNCTION finance_auxiliary_catalog_guard();

CREATE UNIQUE INDEX "FbaWorkflowOptionSelection_scope_key" ON "FbaWorkflowOptionSelection"("organizationId","workspaceId","snapshotId");
