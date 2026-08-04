DROP INDEX IF EXISTS "AiModelSetting_userId_key";
DROP INDEX IF EXISTS "ListingAiWorkspace_userId_key";
DROP INDEX IF EXISTS "WorkspaceSnapshot_userId_key";

CREATE UNIQUE INDEX "AiModelSetting_organizationId_userId_key" ON "AiModelSetting"("organizationId", "userId");
CREATE INDEX "AiModelSetting_userId_updatedAt_idx" ON "AiModelSetting"("userId", "updatedAt");

CREATE UNIQUE INDEX "ListingAiWorkspace_organizationId_userId_key" ON "ListingAiWorkspace"("organizationId", "userId");
CREATE INDEX "ListingAiWorkspace_userId_updatedAt_idx" ON "ListingAiWorkspace"("userId", "updatedAt");

CREATE UNIQUE INDEX "WorkspaceSnapshot_organizationId_userId_key" ON "WorkspaceSnapshot"("organizationId", "userId");
CREATE INDEX "WorkspaceSnapshot_userId_updatedAt_idx" ON "WorkspaceSnapshot"("userId", "updatedAt");

