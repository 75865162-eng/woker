import { NextResponse } from "next/server";
import { getEffectiveRolePermissionMap, roleCanPerformAction, rolePermissionsCookieName, type RolePermissionMap } from "@/lib/accounts/permissions";
import {
  getOrganizationRolePermissions,
  getOrganizationRoleSettings,
  normalizeRoleSettings,
  saveOrganizationRoleAccess,
  type OrganizationRoleSettings,
} from "@/lib/accounts/role-permissions-server";
import { accountRoleIds, type AccountRoleId } from "@/lib/accounts/team-roster";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

function buildPermissionsCookie(permissions: unknown) {
  return `${rolePermissionsCookieName}=${encodeURIComponent(JSON.stringify(permissions))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function protectedRolePermissions(user: { id: string; email: string; role: string }, currentPermissions: RolePermissionMap) {
  const protectedPermissions: RolePermissionMap = {
    owner: currentPermissions.owner,
  };

  if (user.role === "operations_supervisor") {
    protectedPermissions.database_admin = currentPermissions.database_admin;
    protectedPermissions.operations_supervisor = currentPermissions.operations_supervisor;
  }

  return protectedPermissions;
}

function getProtectedRoleIds(user: { id: string; email: string; role: string }) {
  const protectedRoleIds: AccountRoleId[] = ["owner"];

  if (user.role === "operations_supervisor") {
    protectedRoleIds.push("database_admin", "operations_supervisor");
  }

  return new Set(protectedRoleIds);
}

function scopedRoleSettings(
  user: { id: string; email: string; role: string },
  requestedSettings: OrganizationRoleSettings,
  currentSettings: OrganizationRoleSettings,
) {
  const protectedRoleIds = getProtectedRoleIds(user);
  const hiddenRoleIds = accountRoleIds.filter((roleId) =>
    protectedRoleIds.has(roleId)
      ? currentSettings.hiddenRoleIds.includes(roleId)
      : requestedSettings.hiddenRoleIds.includes(roleId),
  );
  const labels: OrganizationRoleSettings["labels"] = {};

  for (const roleId of accountRoleIds) {
    const label = protectedRoleIds.has(roleId) ? currentSettings.labels[roleId] : requestedSettings.labels[roleId];
    if (label) labels[roleId] = label;
  }

  return {
    labels,
    hiddenRoleIds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissions = await getOrganizationRolePermissions(user.organizationId);
  const roleSettings = await getOrganizationRoleSettings(user.organizationId);
  const response = NextResponse.json({ permissions, roleSettings });
  response.headers.append("Set-Cookie", buildPermissionsCookie(permissions));

  return response;
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const currentPermissions = await getOrganizationRolePermissions(user.organizationId);

  if (!roleCanPerformAction(user.role, "accounts", "edit", currentPermissions)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const currentSettings = await getOrganizationRoleSettings(user.organizationId);
  const body = (await request.json()) as { permissions?: unknown; roleSettings?: unknown };
  const requestedPermissions = getEffectiveRolePermissionMap(
    isRecord(body.permissions) ? (body.permissions as RolePermissionMap) : undefined,
  );
  const requestedRoleSettings = normalizeRoleSettings(body.roleSettings);
  const scopedPermissions: RolePermissionMap = {
    ...requestedPermissions,
    ...protectedRolePermissions(user, currentPermissions),
  };
  const settings = scopedRoleSettings(user, requestedRoleSettings, currentSettings);
  const { permissions, roleSettings } = await saveOrganizationRoleAccess(user.organizationId, scopedPermissions, settings);

  const response = NextResponse.json({ permissions, roleSettings });
  response.headers.append("Set-Cookie", buildPermissionsCookie(permissions));

  return response;
}
