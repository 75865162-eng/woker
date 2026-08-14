import { accountRoleIds } from "@/lib/accounts/team-roster";

export type PermissionAction = "view" | "create" | "edit" | "approve" | "export";

export type RolePermissions = Record<string, PermissionAction[]>;

export type RolePermissionMap = Record<string, RolePermissions>;

export const rolePermissionsCookieName = "amazon_bulk_ad_role_permissions";
const validRoleIds = new Set<string>(accountRoleIds);

export const permissionActions: Array<{ id: PermissionAction; label: string }> = [
  { id: "view", label: "查看" },
  { id: "create", label: "新建" },
  { id: "edit", label: "编辑" },
  { id: "approve", label: "审批" },
  { id: "export", label: "导出" },
];

export const permissionModules = [
  { id: "products", name: "产品管理", paths: ["/dashboard"] },
  { id: "sellfox", name: "Sellfox 同步", paths: ["/sellfox"] },
  { id: "workspace", name: "PPC 优化", paths: ["/workspace"] },
  { id: "searchMerge", name: "赛狐搜词合并", paths: ["/saihu-search-merge"] },
  { id: "searchMergeHistory", name: "搜索词历史", paths: ["/history"] },
  { id: "listingAi", name: "Listing AI", paths: ["/listing-ai"] },
  { id: "imageUpscale", name: "图片放大", paths: ["/image-upscale"] },
  { id: "logistics", name: "物流处理", paths: ["/logistics"] },
  { id: "tasks", name: "任务中心", paths: ["/tasks"] },
  { id: "versions", name: "版本审计", paths: ["/versions"] },
  { id: "accounts", name: "账号权限", paths: ["/accounts"] },
  { id: "settings", name: "系统设置", paths: ["/settings"] },
];

const legacyRouteModuleIds = [{ moduleId: "workspace", path: "/rules" }];

export const routeModuleIds = [
  ...permissionModules.flatMap((module) =>
    module.paths.map((path) => ({
      moduleId: module.id,
      path,
    })),
  ),
  ...legacyRouteModuleIds,
];

export const defaultRolePermissionMap: RolePermissionMap = {
  owner: createFullPermissions(),
  database_admin: createPermissions(
    ["products", "sellfox", "workspace", "searchMerge", "searchMergeHistory", "listingAi", "imageUpscale", "logistics", "tasks", "versions", "accounts", "settings"],
    ["view", "create", "edit", "export"],
  ),
  operations_supervisor: createPermissions(["products", "sellfox", "listingAi", "imageUpscale"], ["view", "create", "edit", "approve", "export"]),
  operations: createPermissions(["products", "listingAi", "imageUpscale"], ["view", "create", "edit", "export"]),
  operations_assistant: createPermissions(["products", "listingAi"], ["view", "create", "edit"]),
  developer: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  warehouse: createPermissions(["logistics"], ["view", "create", "edit", "export"]),
  warehouse_supervisor: createPermissions(
    ["logistics", "accounts"],
    ["view", "create", "edit", "approve", "export"],
  ),
  finance: createPermissions(["products", "workspace", "logistics", "versions"], ["view", "export"]),
  procurement: createPermissions(["products", "logistics"], ["view", "create", "edit", "export"]),
  designer: createPermissions(["products", "listingAi", "imageUpscale"], ["view"]),
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

  const merged: RolePermissionMap = { ...defaultRolePermissionMap };

  for (const [roleId, rolePermissions] of Object.entries(overrides)) {
    if (!validRoleIds.has(roleId)) continue;

    merged[roleId] = {
      ...(merged[roleId] ?? defaultRolePermissionMap[roleId] ?? {}),
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

  return getRoleModulePermissionActions(role, moduleId, permissions).length > 0;
}

export function roleCanPerformAction(
  role: string | undefined,
  moduleId: string | null,
  action: PermissionAction,
  permissions?: RolePermissionMap | null,
) {
  if (!moduleId) return true;

  return getRoleModulePermissionActions(role, moduleId, permissions).includes(action);
}

export function roleHasAnyPage(role: string | undefined, permissions?: RolePermissionMap | null) {
  return permissionModules.some((module) => getRoleModulePermissionActions(role, module.id, permissions).length > 0);
}

function getModulePermissionActions(rolePermissions: RolePermissions, moduleId: string) {
  return rolePermissions[moduleId] ?? [];
}

function getRoleModulePermissionActions(role: string | undefined, moduleId: string, permissions?: RolePermissionMap | null) {
  const effectivePermissions = getEffectiveRolePermissionMap(permissions);
  const roleId = role ?? "";
  const actions = getModulePermissionActions(effectivePermissions[roleId] ?? {}, moduleId);

  return actions;
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
