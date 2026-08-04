-- Persist role permission matrices per organization so Accounts changes affect other users.
CREATE TABLE IF NOT EXISTS "OrganizationRolePermission" (
    "organizationId" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationRolePermission_pkey" PRIMARY KEY ("organizationId")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'OrganizationRolePermission_organizationId_fkey'
    ) THEN
        ALTER TABLE "OrganizationRolePermission"
            ADD CONSTRAINT "OrganizationRolePermission_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
