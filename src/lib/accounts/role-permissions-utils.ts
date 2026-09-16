import { permissionActions, type PermissionAction, type RolePermissionMap, type RolePermissions } from "@/lib/accounts/permissions";

const validActions = new Set<PermissionAction>(permissionActions.map((action) => action.id));

export function normalizeRolePermissionMap(value: unknown): RolePermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
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

  return result;
}

export function normalizeRolePermissions(value: unknown): RolePermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: RolePermissions = {};

  for (const [moduleId, actions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(actions)) continue;

    result[moduleId] = actions.filter((action): action is PermissionAction => validActions.has(action as PermissionAction));
  }

  return result;
}

export function cloneRolePermissionMap(value: RolePermissionMap): RolePermissionMap {
  return Object.fromEntries(
    Object.entries(value).map(([roleId, modules]) => [
      roleId,
      Object.fromEntries(Object.entries(modules).map(([moduleId, actions]) => [moduleId, [...actions]])),
    ]),
  );
}
