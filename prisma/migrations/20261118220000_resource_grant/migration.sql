-- 账号权限中心：统一授权表 ResourceGrant（角色/成员 × 功能/数据）。
-- 迁移期不删旧表；旧表与新表双读，计算统一走 effective-access service。
CREATE TABLE "ResourceGrant" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'default',
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "scopeJson" JSONB,
  "actions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ResourceGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResourceGrant_scope_subject_resource_key"
  ON "ResourceGrant"("organizationId", "workspaceId", "subjectType", "subjectId", "resourceType", "resourceId");
CREATE INDEX "ResourceGrant_subject_lookup_idx"
  ON "ResourceGrant"("organizationId", "workspaceId", "subjectType", "subjectId", "enabled");
CREATE INDEX "ResourceGrant_resource_lookup_idx"
  ON "ResourceGrant"("organizationId", "resourceType", "resourceId", "enabled");
