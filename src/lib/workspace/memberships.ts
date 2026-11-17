import { prisma } from "@/lib/db/prisma";
import { WorkspaceScopeError } from "./scope";

type MembershipClient = Pick<typeof prisma, "organizationMember" | "workspaceScope" | "workspaceMembership" | "auditLog">;

export async function requireWorkspaceOwner(organizationId: string, userId: string, client: Pick<typeof prisma, "organizationMember"> = prisma) {
  const member = await client.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, user: { select: { status: true } } } });
  if (member?.role !== "owner" || member.user.status !== "active") throw new WorkspaceScopeError("只有组织所有者可以管理工作区成员。", 403);
}

export async function manageWorkspaceMembership(organizationId: string, workspaceId: string, actor: string, userId: string, grant: boolean) {
  if (![organizationId, workspaceId, actor, userId].every(value => typeof value === "string" && value.trim())) throw new WorkspaceScopeError("缺少成员或工作区。", 400);
  return prisma.$transaction(async tx => changeWorkspaceMembership(organizationId, workspaceId, actor, userId, grant, tx));
}

export async function changeWorkspaceMembership(organizationId: string, workspaceId: string, actor: string, userId: string, grant: boolean, client: MembershipClient) {
  await requireWorkspaceOwner(organizationId, actor, client);
  const [workspace, member] = await Promise.all([
    client.workspaceScope.findUnique({ where: { organizationId_id: { organizationId, id: workspaceId } }, select: { id: true } }),
    client.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, user: { select: { status: true } } } }),
  ]);
  if (!workspace || !member || grant && member.user.status !== "active") throw new WorkspaceScopeError("工作区或有效组织成员不存在。", 403);
  if (member.role === "owner") throw new WorkspaceScopeError("组织所有者的工作区访问由组织所有权管理。", 400);
  const key = { organizationId, workspaceId, userId };
  if (grant) await client.workspaceMembership.upsert({ where: { organizationId_workspaceId_userId: key }, create: key, update: {} });
  else await client.workspaceMembership.deleteMany({ where: key });
  await client.auditLog.create({ data: { organizationId, userId: actor, action: grant ? "workspace.membership.grant" : "workspace.membership.revoke", entityType: "WorkspaceMembership", entityId: workspaceId, metadata: { workspaceId, targetUserId: userId } } });
  return { workspaceId, userId, granted: grant };
}
