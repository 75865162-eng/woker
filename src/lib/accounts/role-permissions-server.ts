import { defaultRolePermissionMap, type PermissionAction, type RolePermissionMap } from "@/lib/accounts/permissions";
import { prisma } from "@/lib/db/prisma";

const validActions = new Set<PermissionAction>(["view", "create", "edit", "approve", "export"]);

export function normalizeRolePermissionMap(value: unknown): RolePermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultRolePermissionMap;
  }

  const result: RolePermissionMap = {};

  for (const [roleId, modules] of Object.entries(value as Record<string, unknown>)) {
    if (!modules || typeof modules !== "object" || Array.isArray(modules)) continue;

    result[roleId] = {};

    for (const [moduleId, actions] of Object.entries(modules as Record<string, unknown>)) {
      if (!Array.isArray(actions)) continue;

      result[roleId][moduleId] = actions.filter((action): action is PermissionAction => validActions.has(action as PermissionAction));
    }
  }

  return {
    ...defaultRolePermissionMap,
    ...result,
  };
}

export async function getOrganizationRolePermissions(organizationId: string): Promise<RolePermissionMap> {
  if (!process.env.DATABASE_URL) return defaultRolePermissionMap;

  const saved = await prisma.organizationRolePermission.findUnique({
    where: { organizationId },
  });

  return normalizeRolePermissionMap(saved?.permissions);
}

export async function saveOrganizationRolePermissions(organizationId: string, permissions: unknown) {
  const normalized = normalizeRolePermissionMap(permissions);

  await prisma.organizationRolePermission.upsert({
    where: { organizationId },
    update: { permissions: normalized },
    create: {
      organizationId,
      permissions: normalized,
    },
  });

  return normalized;
}
