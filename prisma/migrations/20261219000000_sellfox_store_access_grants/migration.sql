-- 赛狐店铺数据范围授权（渐进启用）。
-- 语义：工作区若不存在任何 SellfoxDataAccessGrant / SellfoxRoleDataAccessGrant 记录，
--   赛狐只读链路保持旧行为（有 sellfox view 即可见工作区全部店铺），保证升级零破坏；
--   一旦工作区出现任一授权记录，则可见店铺 = 成员授权 storeIds ∪ 角色授权 storeIds，
--   owner / database_admin 仍全量豁免，越界店铺返回 403。
-- storeIds 存 SellfoxStore.id（内部 id）。纯新增表，不改动既有结构，可回滚。

CREATE TABLE "SellfoxDataAccessGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "actions" TEXT[] NOT NULL DEFAULT ARRAY['view']::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxDataAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellfoxRoleDataAccessGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "storeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "actions" TEXT[] NOT NULL DEFAULT ARRAY['view']::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellfoxRoleDataAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellfoxAccess_member_scope_key" ON "SellfoxDataAccessGrant"("organizationId", "workspaceId", "userId");
CREATE INDEX "SellfoxAccess_lookup_idx" ON "SellfoxDataAccessGrant"("organizationId", "workspaceId", "enabled");

CREATE UNIQUE INDEX "SellfoxRoleAccess_role_scope_key" ON "SellfoxRoleDataAccessGrant"("organizationId", "workspaceId", "roleId");
CREATE INDEX "SellfoxRoleAccess_lookup_idx" ON "SellfoxRoleDataAccessGrant"("organizationId", "workspaceId", "enabled");
