import { defaultRolePermissionMap, permissionActions, type PermissionAction, type RolePermissionMap, type RolePermissions } from "@/lib/accounts/permissions";

const validActions = new Set<PermissionAction>(permissionActions.map((action) => action.id));

/** A role row as read from `organizationRosterRole` in every RBAC hot path. */
export type RolePermissionRow = { id: string; permissions: unknown };

/**
 * Single source of truth for merging stored role rows into the default map.
 * Previously duplicated ({ ...defaultRolePermissionMap } + for-loop) in four
 * call sites; the cache read path and direct DB path now share this function so
 * the authorization verdict cannot drift between them.
 */
export function mergeRolePermissions(roles: Iterable<RolePermissionRow>, base: RolePermissionMap = defaultRolePermissionMap): RolePermissionMap {
  const permissions: RolePermissionMap = { ...base };
  for (const role of roles) {
    permissions[role.id] = { ...(permissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  }
  return permissions;
}

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
