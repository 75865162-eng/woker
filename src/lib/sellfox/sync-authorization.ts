import { prisma } from "@/lib/db/prisma";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";

const authorizationDependencies = { member: async (organizationId: string, userId: string) => prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, user: { select: { status: true } } } }), permissions: getOrganizationRolePermissions, workspace: assertWorkspaceAccess };

export async function canExecuteSellfoxSync(scope: { organizationId: string; workspaceId: string; userId: string }, dependencies = authorizationDependencies) {
  const [member, permissions, workspaceExists] = await Promise.all([
    dependencies.member(scope.organizationId, scope.userId),
    dependencies.permissions(scope.organizationId),
    dependencies.workspace(scope.organizationId, scope.workspaceId),
  ]);
  return Boolean(member?.user.status === "active" && workspaceExists && roleCanPerformAction(member.role, "sellfox", "create", permissions));
}
