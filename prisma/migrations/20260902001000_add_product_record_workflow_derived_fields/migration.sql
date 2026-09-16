ALTER TABLE "ProductRecord"
    ADD COLUMN IF NOT EXISTS "currentOwner" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "isOverdue" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProductRecord"
SET
    "currentOwner" = CASE
        WHEN "status" = 'ops_review' THEN COALESCE(NULLIF("opsAssignee", ''), '')
        WHEN "status" IN ('design_in_progress', 'listing_confirming') THEN COALESCE(NULLIF("designerAssignee", ''), '')
        ELSE COALESCE(NULLIF("selectionOwner", ''), COALESCE("payload"->>'developer', ''))
    END,
    "isOverdue" = CASE
        WHEN "status" IN ('listed', 'canceled', 'delisted', 'patent_risk') THEN false
        WHEN "workflowDueAt" IS NULL THEN false
        ELSE "workflowDueAt" < NOW()
    END;

CREATE INDEX IF NOT EXISTS "ProductRecord_organizationId_workspaceId_source_owner_updated"
    ON "ProductRecord"("organizationId", "workspaceId", "source", "currentOwner", "updatedAt");

CREATE INDEX IF NOT EXISTS "ProductRecord_organizationId_workspaceId_source_overdue_updat"
    ON "ProductRecord"("organizationId", "workspaceId", "source", "isOverdue", "updatedAt");
