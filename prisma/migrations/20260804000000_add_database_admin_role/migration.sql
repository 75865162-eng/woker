-- Separate technical data administration from organization ownership.
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'database_admin';
