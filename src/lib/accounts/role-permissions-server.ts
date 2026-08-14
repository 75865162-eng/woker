import { accountRoleIds, type AccountRoleId } from "@/lib/accounts/team-roster";
import { createFullPermissions, defaultRolePermissionMap, permissionModules, type PermissionAction, type RolePermissionMap } from "@/lib/accounts/permissions";
import { prisma } from "@/lib/db/prisma";

const validActions = new Set<PermissionAction>(["view", "create", "edit", "approve", "export"]);
const validRoleIds = new Set<string>(accountRoleIds);
const validModuleIds = new Set<string>(permissionModules.map((module) => module.id));

export type OrganizationRoleSettings = {
  labels: Partial<Record<AccountRoleId, string>>;
  hiddenRoleIds: AccountRoleId[];
};

const defaultRoleSettings: OrganizationRoleSettings = {
  labels: {},
  hiddenRoleIds: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getStoredPermissions(value: unknown) {
  if (!isRecord(value)) return value;

  return isRecord(value.permissions) ? value.permissions : value;
}

function getStoredRoleSettings(value: unknown) {
  if (!isRecord(value) || !isRecord(value.roleSettings)) return null;

  return value.roleSettings;
}

export function normalizeRoleSettings(value: unknown): OrganizationRoleSettings {
  if (!isRecord(value)) return defaultRoleSettings;

  const labels: OrganizationRoleSettings["labels"] = {};
  const rawLabels = isRecord(value.labels) ? value.labels : {};

  for (const [roleId, label] of Object.entries(rawLabels)) {
    if (!validRoleIds.has(roleId) || typeof label !== "string") continue;

    const trimmed = label.trim();
    if (trimmed) labels[roleId as AccountRoleId] = trimmed.slice(0, 24);
  }

  const hiddenRoleIds = Array.isArray(value.hiddenRoleIds)
    ? value.hiddenRoleIds.filter((roleId): roleId is AccountRoleId => validRoleIds.has(String(roleId)) && roleId !== "owner")
    : [];

  return {
    labels,
    hiddenRoleIds: Array.from(new Set(hiddenRoleIds)),
  };
}

function buildStoredRoleAccess(permissions: RolePermissionMap, roleSettings: OrganizationRoleSettings) {
  return {
    permissions,
    roleSettings,
  };
}

export function normalizeRolePermissionMap(value: unknown): RolePermissionMap {
  const permissionValue = getStoredPermissions(value);

  if (!permissionValue || typeof permissionValue !== "object" || Array.isArray(permissionValue)) {
    return defaultRolePermissionMap;
  }

  // Start with role defaults so permission matrices saved before a new page was added
  // inherit that page's intended access. Explicit saved values still take precedence.
  const result: RolePermissionMap = Object.fromEntries(
    accountRoleIds.map((roleId) => [roleId, { ...(defaultRolePermissionMap[roleId] ?? {}) }]),
  );

  for (const [roleId, modules] of Object.entries(permissionValue as Record<string, unknown>)) {
    if (!modules || typeof modules !== "object" || Array.isArray(modules)) continue;

    if (!validRoleIds.has(roleId)) continue;

    result[roleId] = result[roleId] ?? {};

    for (const [moduleId, actions] of Object.entries(modules as Record<string, unknown>)) {
      if (!validModuleIds.has(moduleId) || !Array.isArray(actions)) continue;

      result[roleId][moduleId] = actions.filter((action): action is PermissionAction => validActions.has(action as PermissionAction));
    }
  }

  // The owner role is the in-product "超级管理员" and must always retain recovery access.
  result.owner = createFullPermissions();

  return result;
}

export async function getOrganizationRolePermissions(organizationId: string): Promise<RolePermissionMap> {
  if (!process.env.DATABASE_URL) return defaultRolePermissionMap;

  const saved = await prisma.organizationRolePermission.findUnique({
    where: { organizationId },
  });

  return normalizeRolePermissionMap(saved?.permissions);
}

export async function getOrganizationRoleSettings(organizationId: string): Promise<OrganizationRoleSettings> {
  if (!process.env.DATABASE_URL) return defaultRoleSettings;

  const saved = await prisma.organizationRolePermission.findUnique({
    where: { organizationId },
  });

  return normalizeRoleSettings(getStoredRoleSettings(saved?.permissions));
}

export async function saveOrganizationRolePermissions(organizationId: string, permissions: unknown) {
  const normalized = normalizeRolePermissionMap(permissions);
  const saved = process.env.DATABASE_URL
    ? await prisma.organizationRolePermission.findUnique({
        where: { organizationId },
      })
    : null;
  const roleSettings = normalizeRoleSettings(getStoredRoleSettings(saved?.permissions));

  await prisma.organizationRolePermission.upsert({
    where: { organizationId },
    update: { permissions: buildStoredRoleAccess(normalized, roleSettings) },
    create: {
      organizationId,
      permissions: buildStoredRoleAccess(normalized, roleSettings),
    },
  });

  return normalized;
}

export async function saveOrganizationRoleAccess(
  organizationId: string,
  permissions: unknown,
  roleSettings: unknown,
) {
  const normalizedPermissions = normalizeRolePermissionMap(permissions);
  const normalizedRoleSettings = normalizeRoleSettings(roleSettings);

  await prisma.organizationRolePermission.upsert({
    where: { organizationId },
    update: { permissions: buildStoredRoleAccess(normalizedPermissions, normalizedRoleSettings) },
    create: {
      organizationId,
      permissions: buildStoredRoleAccess(normalizedPermissions, normalizedRoleSettings),
    },
  });

  return {
    permissions: normalizedPermissions,
    roleSettings: normalizedRoleSettings,
  };
}
