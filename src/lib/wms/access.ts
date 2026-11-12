import type { Prisma } from "@prisma/client";
import { type PermissionAction } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { WmsInputError } from "./rules";
import type { WmsScope } from "./contracts";

export function scoped(scope: WmsScope) {
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
}

export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function authorizeWms(
  tx: Prisma.TransactionClient,
  scope: WmsScope,
  action: PermissionAction,
  override?: { userId: string; action: PermissionAction },
) {
  const identities = new Map([[scope.actorUserId, action]]);
  if (override) identities.set(override.userId, override.action);
  for (const userId of [...identities.keys()].sort()) {
    await assertWmsAccess(tx, { ...scope, userId, action: identities.get(userId)! });
  }
}

export async function auditWms(
  tx: Prisma.TransactionClient,
  scope: WmsScope,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      userId: scope.actorUserId,
      action: `wms.${action}`,
      entityType: "WMS",
      entityId,
      metadata: { workspaceId: scope.workspaceId, detail: metadata },
    },
  });
}

export async function assertWmsAccess(
  tx: Prisma.TransactionClient,
  input: WmsScope & { userId: string; action: PermissionAction },
) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId} FOR SHARE`;
  const membership = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT m.role::text AS role
    FROM "OrganizationMember" m
    JOIN "User" u ON u.id = m."userId"
    WHERE m."organizationId" = ${input.organizationId} AND m."userId" = ${input.userId} AND u.status = 'active'
    FOR SHARE OF m, u
  `;
  const roleId = membership[0]?.role;
  if (!roleId) throw new WmsInputError("当前账号不属于此组织。", 403);

  const roster = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status FROM "TeamRosterMember"
    WHERE "organizationId" = ${input.organizationId} AND id = ${input.userId}
    FOR SHARE
  `;
  if (roster[0] && roster[0].status !== "active") throw new WmsInputError("当前成员已停用。", 403);

  const roles = await tx.$queryRaw<Array<{ permissions: unknown }>>`
    SELECT permissions FROM "OrganizationRosterRole"
    WHERE "organizationId" = ${input.organizationId} AND id = ${roleId}
    FOR SHARE
  `;
  if (!roles[0]) throw new WmsInputError("组织角色目录尚未就绪。", 403);
  const permissions = normalizeRolePermissions(roles[0].permissions);
  if (!permissions.wms?.includes(input.action)) throw new WmsInputError("当前账号没有此 WMS 操作权限。", 403);

  const workspace = await tx.workspaceScope.findUnique({
    where: { organizationId_id: { organizationId: input.organizationId, id: input.workspaceId } },
    select: { id: true },
  });
  if (!workspace) throw new WmsInputError("工作区不存在。", 403);
  return { roleId, permissions };
}
