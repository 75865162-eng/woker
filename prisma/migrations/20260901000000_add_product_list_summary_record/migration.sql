CREATE TABLE IF NOT EXISTS "ProductListSummaryRecord" (
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "developing" INTEGER NOT NULL DEFAULT 0,
    "opsReview" INTEGER NOT NULL DEFAULT 0,
    "designInProgress" INTEGER NOT NULL DEFAULT 0,
    "operationsProgress" INTEGER NOT NULL DEFAULT 0,
    "overdue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductListSummaryRecord_pkey" PRIMARY KEY ("organizationId", "workspaceId", "source")
);

CREATE INDEX IF NOT EXISTS "ProductListSummaryRecord_organizationId_workspaceId_updatedAt_idx" ON "ProductListSummaryRecord"("organizationId", "workspaceId", "updatedAt");

DO $$ BEGIN
    ALTER TABLE "ProductListSummaryRecord"
        ADD CONSTRAINT "ProductListSummaryRecord_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
