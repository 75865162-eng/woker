import { randomUUID } from "node:crypto";
import { approvedContext } from "./approved-context";
import { assertAmazonScopeAdmin } from "./data-access";
import { requiredText, SyncInputError, type SyncScope } from "./policy";

export async function saveAccessGrant(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const { tx, approvalId } = approvedContext(scope, "save-access-grant");
  await assertAmazonScopeAdmin(scope, actor, tx);
  const roleId = command.roleId === undefined ? undefined : requiredText(command.roleId, "角色");
  if (roleId && command.userId) throw new SyncInputError("成员和角色只能选择一种。");
  const userId = roleId ? undefined : requiredText(command.userId, "成员"), sellerAccountId = requiredText(command.sellerAccountId, "Seller");
  if (typeof command.enabled !== "boolean") throw new SyncInputError("须明确启用或撤销范围授权。");
  const where = { organizationId_workspaceId_userId_sellerAccountId: { ...scope, userId: userId!, sellerAccountId } };
  const roleWhere = { organizationId_workspaceId_roleId_sellerAccountId: { ...scope, roleId: roleId!, sellerAccountId } };
  const prior = roleId ? await tx.amazonRoleDataAccessGrant.findUnique({ where: roleWhere }) : await tx.amazonDataAccessGrant.findUnique({ where });
  if (!Number.isInteger(command.revision) || command.revision !== (prior?.revision ?? 0)) throw new SyncInputError("范围授权版本已变化。", 409);
  if (roleId) {
    if (!await tx.organizationRosterRole.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: roleId } } })) throw new SyncInputError("成员或 Seller 不属于当前范围。", 403);
  } else {
    const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: userId! } }, include: { user: { select: { status: true } } } });
    if (!member || (command.enabled && member.user.status !== "active")) throw new SyncInputError("成员或 Seller 不属于当前范围。", 403);
  }
  if (!await tx.sellerAccount.findFirst({ where: { ...scope, id: sellerAccountId }, select: { id: true } })) throw new SyncInputError("成员或 Seller 不属于当前范围。", 403);
  const actions = command.actions ?? prior?.actions ?? ["view", "sync", "export", "edit"];
  const marketplaceIds = command.marketplaceIds ?? prior?.marketplaceIds ?? [];
  const mcpEnabled = command.mcpEnabled ?? prior?.mcpEnabled ?? false;
  if (!Array.isArray(actions) || actions.length > 4 || actions.some(a => !["view", "sync", "export", "edit"].includes(a)) || !Array.isArray(marketplaceIds) || marketplaceIds.length > 30 || marketplaceIds.some(m => typeof m !== "string" || !m || m.length > 200) || typeof mcpEnabled !== "boolean") throw new SyncInputError("范围或操作权限无效。");
  const data = { enabled: command.enabled, actions: [...new Set(actions)] as string[], marketplaceIds: [...new Set(marketplaceIds)] as string[], mcpEnabled };
  const row = roleId
    ? prior ? await tx.amazonRoleDataAccessGrant.update({ where: { id: prior.id, revision: prior.revision }, data: { ...data, revision: { increment: 1 } } }) : await tx.amazonRoleDataAccessGrant.create({ data: { id: requiredText(command.proposedId, "授权 ID"), ...scope, roleId, sellerAccountId, ...data } })
    : prior ? await tx.amazonDataAccessGrant.update({ where: { id: prior.id, revision: prior.revision }, data: { ...data, revision: { increment: 1 } } }) : await tx.amazonDataAccessGrant.create({ data: { id: requiredText(command.proposedId, "授权 ID"), ...scope, userId: userId!, sellerAccountId, ...data } });
  await tx.auditLog.create({ data: { id: randomUUID(), organizationId: scope.organizationId, userId: actor, action: "amazon.data.scope.changed", entityType: roleId ? "AmazonRoleDataAccessGrant" : "AmazonDataAccessGrant", entityId: row.id, metadata: { workspaceId: scope.workspaceId, subjectUserId: userId, roleId, sellerAccountId, ...data, revision: row.revision, approvalId } } });
  return row;
}
