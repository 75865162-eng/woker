export type PermissionAction = "view" | "create" | "edit" | "approve" | "export";

export type RolePermissions = Record<string, PermissionAction[]>;

export type RolePermissionMap = Record<string, RolePermissions>;

export const rolePermissionsCookieName = "amazon_bulk_ad_role_permissions";

export const permissionActions: Array<{ id: PermissionAction; label: string }> = [
  { id: "view", label: "查看" },
  { id: "create", label: "新建" },
  { id: "edit", label: "编辑" },
  { id: "approve", label: "审批" },
  { id: "export", label: "导出" },
];

export const permissionModules = [
  { id: "workspace", name: "PPC Workspace", paths: ["/workspace", "/history"] },
  { id: "products", name: "Products", paths: ["/dashboard"] },
  { id: "searchMerge", name: "Search Merge", paths: ["/saihu-search-merge"] },
  { id: "listingAi", name: "Listing AI", paths: ["/listing-ai"] },
  { id: "imageUpscale", name: "Image Upscale", paths: ["/image-upscale"] },
  { id: "logistics", name: "Logistics", paths: ["/logistics"] },
  { id: "rules", name: "Rule Center", paths: ["/rules"] },
  { id: "accounts", name: "Accounts", paths: ["/accounts"] },
  { id: "settings", name: "Settings", paths: ["/settings"] },
];

export const routeModuleIds = permissionModules.flatMap((module) =>
  module.paths.map((path) => ({
    moduleId: module.id,
    path,
  })),
);

export const defaultRolePermissionMap: RolePermissionMap = {
  owner: createFullPermissions(),
  database_admin: createPermissions(
    ["workspace", "products", "searchMerge", "listingAi", "imageUpscale", "logistics", "rules", "accounts", "settings"],
    ["view", "create", "edit", "export"],
  ),
  admin: createPermissions(["workspace", "products", "searchMerge", "listingAi", "imageUpscale", "logistics", "rules"], allActions()),
  operations_manager: createPermissions(["workspace", "products", "searchMerge", "listingAi", "imageUpscale", "logistics", "rules"], allActions()),
  operations_supervisor: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "approve", "export"]),
  operations: createPermissions(["products", "listingAi"], ["view", "create", "edit", "export"]),
  operations_assistant: createPermissions(["products", "listingAi"], ["view", "create", "edit"]),
  developer: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  warehouse: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  warehouse_supervisor: createPermissions(["logistics"], ["view", "create", "edit", "approve", "export"]),
  finance: createPermissions(["workspace", "products", "logistics"], ["view", "export"]),
  procurement: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  selection: createPermissions(["products"], ["view", "create", "edit"]),
  designer: createPermissions(["products", "listingAi", "imageUpscale"], ["view"]),
  ppc_specialist: createPermissions(["workspace", "searchMerge", "rules"], ["view", "create", "edit", "export"]),
  ppc_manager: createPermissions(["workspace", "searchMerge", "rules"], ["view", "create", "edit", "export"]),
  listing_specialist: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "export"]),
  listing_operator: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "export"]),
  logistics_specialist: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  logistics_operator: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  viewer: {},
};

export function allActions() {
  return permissionActions.map((action) => action.id);
}

export function createFullPermissions(): RolePermissions {
  return Object.fromEntries(permissionModules.map((module) => [module.id, allActions()]));
}

export function createPermissions(moduleIds: string[], actions: PermissionAction[]): RolePermissions {
  return Object.fromEntries(moduleIds.map((moduleId) => [moduleId, actions]));
}

export function getEffectiveRolePermissionMap(overrides?: RolePermissionMap | null): RolePermissionMap {
  if (!overrides) return defaultRolePermissionMap;

  return {
    ...defaultRolePermissionMap,
    ...overrides,
  };
}

export function getModuleIdForPath(pathname: string): string | null {
  const match = routeModuleIds.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`));

  return match?.moduleId ?? null;
}

export function roleCanAccessModule(role: string | undefined, moduleId: string | null, permissions?: RolePermissionMap | null) {
  if (!moduleId) return true;

  const rolePermissions = getEffectiveRolePermissionMap(permissions)[role ?? ""] ?? {};

  return (rolePermissions[moduleId] ?? []).length > 0;
}

export function roleHasAnyPage(role: string | undefined, permissions?: RolePermissionMap | null) {
  const rolePermissions = getEffectiveRolePermissionMap(permissions)[role ?? ""] ?? {};

  return permissionModules.some((module) => (rolePermissions[module.id] ?? []).length > 0);
}

export function parseRolePermissionsCookie(value?: string): RolePermissionMap | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as RolePermissionMap;

    if (!parsed || typeof parsed !== "object") return null;

    return parsed;
  } catch {
    return null;
  }
}
