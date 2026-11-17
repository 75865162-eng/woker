import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { SellfoxBrowseError } from "./browse-query";

type Scope = { organizationId: string; workspaceId: string };
type Actor = { id: string; role: string };
type Db = Prisma.TransactionClient;

function missingGrantTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}
function isScopeAdmin(role: string) {
  return role === "owner" || role === "database_admin";
}

/**
 * Progressive sellfox store scoping.
 * Returns `undefined` when no extra restriction applies (admin, or workspace has
 * not configured any grant yet — preserves legacy workspace-wide behavior).
 * Returns a concrete internal-store-id list when scoping is active; visible =
 * member grants UNION role grants, intersected with stores actually in scope.
 */
export async function resolveSellfoxVisibleStoreIds(actor: Actor, scope: Scope, db: Db = prisma): Promise<string[] | undefined> {
  if (isScopeAdmin(actor.role)) return undefined;
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor.id } }, select: { role: true, user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, actor.id, db)) throw new SellfoxBrowseError("赛狐数据范围不可访问。", 403);
  let memberGrants: { storeIds: string[] }[], roleGrants: { storeIds: string[] }[];
  try {
    [memberGrants, roleGrants] = await Promise.all([
      db.sellfoxDataAccessGrant.findMany({ where: { ...scope, userId: actor.id, enabled: true }, select: { storeIds: true }, take: 201 }),
      db.sellfoxRoleDataAccessGrant.findMany({ where: { ...scope, roleId: member.role, enabled: true }, select: { storeIds: true }, take: 201 }),
    ]);
  } catch (error) {
    // 迁移尚未执行（新表不存在）时降级为旧行为，避免升级中断。
    if (missingGrantTable(error)) return undefined;
    throw error;
  }
  if (!memberGrants.length && !roleGrants.length) return undefined; // 渐进：工作区未启用授权
  const requested = new Set<string>();
  for (const grant of [...memberGrants, ...roleGrants]) for (const id of grant.storeIds) requested.add(id);
  if (!requested.size) return [];
  const valid = await db.sellfoxStore.findMany({ where: { ...scope, id: { in: [...requested] } }, select: { id: true } });
  return valid.map(s => s.id);
}

/** Admin-only grant writer. One row per subject (member or role) per workspace. */
export async function saveSellfoxStoreGrant(scope: Scope, actor: Actor, command: Record<string, unknown>, db: Db = prisma) {
  await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, actor.id, db);
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor.id } }, select: { role: true, user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !isScopeAdmin(member.role)) throw new SellfoxBrowseError("赛狐店铺授权仅限组织管理员。", 403);
  const roleId = command.roleId === undefined ? undefined : String(command.roleId).trim();
  if (roleId && command.userId) throw new SellfoxBrowseError("成员和角色只能选择一种。", 400);
  const userId = roleId ? undefined : String(command.userId ?? "").trim();
  if (!roleId && !userId) throw new SellfoxBrowseError("必须指定成员或角色。", 400);
  if (typeof command.enabled !== "boolean") throw new SellfoxBrowseError("须明确启用或撤销授权。", 400);
  if (!Number.isInteger(command.revision)) throw new SellfoxBrowseError("授权版本无效。", 409);
  const storeIdsRaw = command.storeIds;
  if (!Array.isArray(storeIdsRaw) || storeIdsRaw.length > 2000 || storeIdsRaw.some(id => typeof id !== "string" || !id || id.length > 200)) throw new SellfoxBrowseError("店铺范围无效。", 400);
  const storeIds = [...new Set(storeIdsRaw as string[])];
  if (storeIds.length) {
    const stores = await db.sellfoxStore.findMany({ where: { ...scope, id: { in: storeIds } }, select: { id: true } });
    if (stores.length !== storeIds.length) throw new SellfoxBrowseError("店铺不属于当前工作区。", 403);
  }
  const actions = command.actions ?? ["view"];
  if (!Array.isArray(actions) || actions.length > 8 || actions.some(a => a !== "view")) throw new SellfoxBrowseError("赛狐授权当前仅支持 view。", 400);

  return db.$transaction(async tx => {
    if (roleId) {
      if (!await tx.organizationRosterRole.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: roleId } } })) throw new SellfoxBrowseError("角色不属于当前组织。", 403);
      const prior = await tx.sellfoxRoleDataAccessGrant.findUnique({ where: { organizationId_workspaceId_roleId: { ...scope, roleId } } });
      if ((command.revision as number) !== (prior?.revision ?? 0)) throw new SellfoxBrowseError("授权版本已变化，请刷新后重试。", 409);
      const data = { storeIds, actions: [...new Set(actions as string[])], enabled: command.enabled as boolean };
      const row = prior
        ? await tx.sellfoxRoleDataAccessGrant.update({ where: { id: prior.id, revision: prior.revision }, data: { ...data, revision: { increment: 1 } } })
        : await tx.sellfoxRoleDataAccessGrant.create({ data: { id: randomUUID(), ...scope, roleId, ...data } });
      await tx.auditLog.create({ data: { id: randomUUID(), organizationId: scope.organizationId, userId: actor.id, action: "sellfox.data.scope.changed", entityType: "SellfoxRoleDataAccessGrant", entityId: row.id, metadata: { ...scope, roleId, ...data, revision: row.revision } } });
      return row;
    }
    const target = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: userId! } }, select: { user: { select: { status: true } } } });
    if (!target || (command.enabled && target.user.status !== "active")) throw new SellfoxBrowseError("成员不属于当前组织或已停用。", 403);
    const prior = await tx.sellfoxDataAccessGrant.findUnique({ where: { organizationId_workspaceId_userId: { ...scope, userId: userId! } } });
    if ((command.revision as number) !== (prior?.revision ?? 0)) throw new SellfoxBrowseError("授权版本已变化，请刷新后重试。", 409);
    const data = { storeIds, actions: [...new Set(actions as string[])], enabled: command.enabled as boolean };
    const row = prior
      ? await tx.sellfoxDataAccessGrant.update({ where: { id: prior.id, revision: prior.revision }, data: { ...data, revision: { increment: 1 } } })
      : await tx.sellfoxDataAccessGrant.create({ data: { id: randomUUID(), ...scope, userId: userId!, ...data } });
    await tx.auditLog.create({ data: { id: randomUUID(), organizationId: scope.organizationId, userId: actor.id, action: "sellfox.data.scope.changed", entityType: "SellfoxDataAccessGrant", entityId: row.id, metadata: { ...scope, userId, ...data, revision: row.revision } } });
    return row;
  });
}
