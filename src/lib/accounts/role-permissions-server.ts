import { defaultRolePermissionMap, type RolePermissionMap } from "@/lib/accounts/permissions";
import { getOrganizationRoleCatalogSnapshot, saveOrganizationRoleCatalog } from "@/lib/accounts/role-catalog-server";
import { cloneRolePermissionMap, normalizeRolePermissionMap } from "@/lib/accounts/role-permissions-utils";

export type RolePermissionsSnapshot = {
  permissions: RolePermissionMap;
  revision: string;
};

function buildRolePermissionsSnapshot(permissions: RolePermissionMap, revision: string): RolePermissionsSnapshot {
  return { permissions, revision };
}

function buildDefaultSnapshot() {
  return buildRolePermissionsSnapshot(cloneRolePermissionMap(defaultRolePermissionMap), "local-default");
}

export async function getOrganizationRolePermissionsSnapshot(organizationId: string): Promise<RolePermissionsSnapshot> {
  if (!process.env.DATABASE_URL) return buildDefaultSnapshot();

  const snapshot = await getOrganizationRoleCatalogSnapshot(organizationId);

  return buildRolePermissionsSnapshot(
    Object.fromEntries(snapshot.roles.map((role) => [role.id, role.permissions])) as RolePermissionMap,
    snapshot.revision,
  );
}

export async function getOrganizationRolePermissions(organizationId: string): Promise<RolePermissionMap> {
  const snapshot = await getOrganizationRolePermissionsSnapshot(organizationId);
  return snapshot.permissions;
}

export async function saveOrganizationRolePermissions(organizationId: string, permissions: unknown): Promise<RolePermissionsSnapshot> {
  if (!process.env.DATABASE_URL) {
    return buildDefaultSnapshot();
  }

  const normalized = normalizeRolePermissionMap(permissions);
  const snapshot = await getOrganizationRoleCatalogSnapshot(organizationId);
  const nextRoles = snapshot.roles.map((role) => ({
    ...role,
    permissions: normalized[role.id] ?? role.permissions,
  }));
  const saved = await saveOrganizationRoleCatalog(organizationId, nextRoles);

  return buildRolePermissionsSnapshot(
    Object.fromEntries(saved.roles.map((role) => [role.id, role.permissions])) as RolePermissionMap,
    saved.revision,
  );
}
