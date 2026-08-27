import { defaultRolePermissionMap, type PermissionAction, type RolePermissionMap } from "@/lib/accounts/permissions";
import { prisma } from "@/lib/db/prisma";
import { isDatabaseUnavailableError } from "@/lib/db/is-database-unavailable-error";

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

  const merged = { ...defaultRolePermissionMap };

  for (const [roleId, rolePermissions] of Object.entries(result)) {
    merged[roleId] = {
      ...(defaultRolePermissionMap[roleId] ?? {}),
      ...rolePermissions,
    };
  }

  return merged;
}

export async function getOrganizationRolePermissions(organizationId: string): Promise<RolePermissionMap> {
  if (!process.env.DATABASE_URL) return defaultRolePermissionMap;

  try {
    const saved = await prisma.organizationRolePermission.findUnique({
      where: { organizationId },
    });

    return normalizeRolePermissionMap(saved?.permissions);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn(`[role-permissions] Falling back to default permissions for ${organizationId}:`, error);
      return defaultRolePermissionMap;
    }

    throw error;
  }
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
