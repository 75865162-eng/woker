CREATE TABLE IF NOT EXISTS "ProductListCacheRecord" (
    "cacheKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductListCacheRecord_pkey" PRIMARY KEY ("cacheKey")
);

CREATE INDEX IF NOT EXISTS "ProductListCacheRecord_organizationId_workspaceId_updatedAt_idx"
    ON "ProductListCacheRecord"("organizationId", "workspaceId", "updatedAt");

CREATE INDEX IF NOT EXISTS "ProductListCacheRecord_scopeKey_expiresAt_idx"
    ON "ProductListCacheRecord"("scopeKey", "expiresAt");

CREATE INDEX IF NOT EXISTS "ProductListCacheRecord_expiresAt_idx"
    ON "ProductListCacheRecord"("expiresAt");

DO $$ BEGIN
    ALTER TABLE "ProductListCacheRecord"
        ADD CONSTRAINT "ProductListCacheRecord_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
