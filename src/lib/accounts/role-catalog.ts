import { buildRoleDefinitions } from "@/lib/accounts/role-definitions";
import { permissionActions, permissionModules } from "@/lib/accounts/permissions";
import type { RolePermissions } from "@/lib/accounts/permissions";

export type RoleCatalogItem = {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  sortOrder: number;
};

export function buildDefaultRoleCatalog(): RoleCatalogItem[] {
  return buildRoleDefinitions(permissionActions.map((action) => action.id), permissionModules.map((module) => module.id)).map((role, index) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    sortOrder: index,
  }));
}
