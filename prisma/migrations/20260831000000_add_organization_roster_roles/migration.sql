CREATE TABLE IF NOT EXISTS "OrganizationRosterRole" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRosterRole_pkey" PRIMARY KEY ("organizationId", "id")
);

CREATE INDEX IF NOT EXISTS "OrganizationRosterRole_organizationId_sortOrder_idx" ON "OrganizationRosterRole"("organizationId", "sortOrder");

DO $$ BEGIN
    ALTER TABLE "OrganizationRosterRole"
        ADD CONSTRAINT "OrganizationRosterRole_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
