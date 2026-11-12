CREATE UNIQUE INDEX "FbaLocalCostAdjustment_scope_id_key" ON "FbaLocalCostAdjustment"("organizationId","workspaceId","id");
CREATE TABLE "FbaLocalFinanceDraft" (
 "id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"adjustmentId" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"ruleInput" JSONB NOT NULL,"voucher" JSONB NOT NULL,"summary" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT_RULES',"createdBy" TEXT NOT NULL,"reviewedBy" TEXT,"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FbaLocalFinanceDraft_adjustment_fkey" FOREIGN KEY ("organizationId","workspaceId","adjustmentId") REFERENCES "FbaLocalCostAdjustment"("organizationId","workspaceId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "FbaLocalFinanceDraft_status_check" CHECK ("status" IN ('DRAFT_RULES','RULES_REVIEWED')),
 CONSTRAINT "FbaLocalFinanceDraft_reviewer_check" CHECK (("status"='DRAFT_RULES' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL) OR ("status"='RULES_REVIEWED' AND "reviewedBy" IS NOT NULL AND "reviewedBy"<>"createdBy" AND "reviewedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "FbaLocalFinanceDraft_request_key" ON "FbaLocalFinanceDraft"("organizationId","workspaceId","adjustmentId","idempotencyKey");
