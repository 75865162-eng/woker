-- Rebuild organization roles so the database, account roster, permission matrix,
-- middleware, and API permission checks all use one canonical role set.
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "OrganizationMember" ALTER COLUMN "role" TYPE text USING "role"::text;

UPDATE "OrganizationMember"
SET "role" = CASE "role"
    WHEN 'admin' THEN 'operations_supervisor'
    WHEN 'operations_manager' THEN 'operations_supervisor'
    WHEN 'ppc_specialist' THEN 'operations'
    WHEN 'listing_specialist' THEN 'operations'
    WHEN 'logistics_specialist' THEN 'warehouse'
    ELSE "role"
END;

UPDATE "OrganizationMember"
SET "role" = 'viewer'
WHERE "role" NOT IN (
    'owner',
    'database_admin',
    'operations_supervisor',
    'operations',
    'operations_assistant',
    'developer',
    'designer',
    'warehouse',
    'warehouse_supervisor',
    'finance',
    'procurement',
    'viewer'
);

DROP TYPE "OrganizationRole";

CREATE TYPE "OrganizationRole" AS ENUM (
    'owner',
    'database_admin',
    'operations_supervisor',
    'operations',
    'operations_assistant',
    'developer',
    'designer',
    'warehouse',
    'warehouse_supervisor',
    'finance',
    'procurement',
    'viewer'
);

ALTER TABLE "OrganizationMember"
ALTER COLUMN "role" TYPE "OrganizationRole"
USING "role"::"OrganizationRole";

ALTER TABLE "OrganizationMember" ALTER COLUMN "role" SET DEFAULT 'viewer';
