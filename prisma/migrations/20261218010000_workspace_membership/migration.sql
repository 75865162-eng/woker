-- 仅新增显式工作区授权；不为任何既有组织成员隐式回填。
CREATE TABLE "WorkspaceMembership" (
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("organizationId", "workspaceId", "userId"),
  CONSTRAINT "WorkspaceMembership_workspace_fkey" FOREIGN KEY ("organizationId", "workspaceId") REFERENCES "WorkspaceScope"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceMembership_member_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkspaceMembership_organizationId_userId_idx" ON "WorkspaceMembership"("organizationId", "userId");
