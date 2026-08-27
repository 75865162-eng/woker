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
  { id: "products", name: "产品管理 /dashboard", paths: ["/dashboard"] },
  { id: "workspace", name: "PPC 优化 /workspace", paths: ["/workspace"] },
  { id: "searchMerge", name: "赛狐搜词合并 /saihu-search-merge", paths: ["/saihu-search-merge"] },
  { id: "listingAi", name: "Listing AI /listing-ai", paths: ["/listing-ai"] },
  { id: "imageUpscale", name: "图片放大 /image-upscale", paths: ["/image-upscale"] },
  { id: "logistics", name: "物流处理 /logistics", paths: ["/logistics"] },
  { id: "tasks", name: "任务中心 /tasks", paths: ["/tasks"] },
  { id: "history", name: "历史记录 /history", paths: ["/history"] },
  { id: "versions", name: "版本审计 /versions", paths: ["/versions"] },
  { id: "accounts", name: "账号权限 /accounts", paths: ["/accounts"] },
  { id: "settings", name: "系统设置 /settings", paths: ["/settings"] },
];

export const defaultAccessiblePaths = [
  { href: "/", moduleId: null },
  { href: "/dashboard", moduleId: "products" },
  { href: "/workspace", moduleId: "workspace" },
  { href: "/saihu-search-merge", moduleId: "searchMerge" },
  { href: "/listing-ai", moduleId: "listingAi" },
  { href: "/logistics", moduleId: "logistics" },
  { href: "/tasks", moduleId: "tasks" },
  { href: "/history", moduleId: "history" },
  { href: "/versions", moduleId: "versions" },
  { href: "/accounts", moduleId: "accounts" },
  { href: "/settings", moduleId: "settings" },
] as const;

export const routeModuleIds = permissionModules.flatMap((module) =>
  module.paths.map((path) => ({
    moduleId: module.id,
    path,
  })),
);

export const defaultRolePermissionMap: RolePermissionMap = {
  owner: createFullPermissions(),
  database_admin: createPermissions(
    ["products", "workspace", "searchMerge", "listingAi", "imageUpscale", "logistics", "tasks", "history", "versions", "accounts", "settings"],
    ["view", "create", "edit", "export"],
  ),
  admin: createPermissions(["products", "workspace", "searchMerge", "listingAi", "imageUpscale", "logistics", "tasks", "history"], allActions()),
  operations_manager: createPermissions(["products", "workspace", "searchMerge", "listingAi", "imageUpscale", "logistics", "tasks", "history"], allActions()),
  operations_supervisor: createPermissions(["products", "listingAi", "imageUpscale", "tasks"], ["view", "create", "edit", "approve", "export"]),
  operations: createPermissions(["products", "listingAi"], ["view", "create", "edit", "export"]),
  operations_assistant: createPermissions(["products", "listingAi"], ["view", "create", "edit"]),
  developer: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  warehouse: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  warehouse_supervisor: createPermissions(["logistics"], ["view", "create", "edit", "approve", "export"]),
  finance: createPermissions(["products", "workspace", "logistics", "history"], ["view", "export"]),
  procurement: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  selection: createPermissions(["products"], ["view", "create", "edit"]),
  designer: createPermissions(["products", "listingAi", "imageUpscale"], ["view"]),
  ppc_specialist: createPermissions(["workspace", "searchMerge"], ["view", "create", "edit", "export"]),
  ppc_manager: createPermissions(["workspace", "searchMerge"], ["view", "create", "edit", "export"]),
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

  const merged = { ...defaultRolePermissionMap };

  for (const [roleId, rolePermissions] of Object.entries(overrides)) {
    merged[roleId] = {
      ...(defaultRolePermissionMap[roleId] ?? {}),
      ...rolePermissions,
    };
  }

  return merged;
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

export function roleCanPerformAction(
  role: string | undefined,
  moduleId: string | null,
  action: PermissionAction,
  permissions?: RolePermissionMap | null,
) {
  if (!moduleId) return true;

  const rolePermissions = getEffectiveRolePermissionMap(permissions)[role ?? ""] ?? {};

  return (rolePermissions[moduleId] ?? []).includes(action);
}

export function roleHasAnyPage(role: string | undefined, permissions?: RolePermissionMap | null) {
  const rolePermissions = getEffectiveRolePermissionMap(permissions)[role ?? ""] ?? {};

  return permissionModules.some((module) => (rolePermissions[module.id] ?? []).length > 0);
}

export function getFirstAccessiblePath(role: string | undefined, permissions?: RolePermissionMap | null) {
  return defaultAccessiblePaths.find((item) => roleCanAccessModule(role, item.moduleId, permissions))?.href ?? "/";
}

export function getAccessiblePathOrFallback(pathname: string | null | undefined, role: string | undefined, permissions?: RolePermissionMap | null) {
  if (pathname && pathname.startsWith("/") && !pathname.startsWith("//")) {
    const moduleId = pathname === "/" ? null : getModuleIdForPath(pathname);

    if (roleCanAccessModule(role, moduleId, permissions)) {
      return pathname;
    }
  }

  return getFirstAccessiblePath(role, permissions);
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
