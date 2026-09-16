ALTER TABLE "ProductRecord"
    ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'dashboard';

UPDATE "ProductRecord"
SET "source" = 'sellfox'
WHERE "id" ILIKE 'sellfox-%'
   OR COALESCE("payload"->>'note', '') ILIKE '%赛狐在线产品 API%';

CREATE INDEX IF NOT EXISTS "ProductRecord_organizationId_workspaceId_source_updatedAt_idx"
    ON "ProductRecord"("organizationId", "workspaceId", "source", "updatedAt");

CREATE INDEX IF NOT EXISTS "ProductRecord_organizationId_workspaceId_source_status_updated"
    ON "ProductRecord"("organizationId", "workspaceId", "source", "status", "updatedAt");
