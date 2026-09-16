DROP INDEX IF EXISTS "DataChangeVersion_organizationId_entityType_entityId_version_ke";

CREATE UNIQUE INDEX "DataChangeVersion_org_workspace_entity_version_key"
  ON "DataChangeVersion"("organizationId", "workspaceId", "entityType", "entityId", "version");
