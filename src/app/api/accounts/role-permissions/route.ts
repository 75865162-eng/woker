import { NextResponse } from "next/server";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissionsSnapshot, saveOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function canManagePermissions(role: string) {
  return role === "owner" || role === "database_admin";
}

function buildPermissionsCookie(permissions: unknown) {
  return `${rolePermissionsCookieName}=${encodeURIComponent(JSON.stringify(permissions))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function diffPermissions(before: Record<string, Record<string, string[]>>, after: Record<string, Record<string, string[]>>) {
  const roleIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Array<{ roleId: string; moduleId: string; before: string[]; after: string[] }> = [];

  for (const roleId of roleIds) {
    const beforeModules = before[roleId] ?? {};
    const afterModules = after[roleId] ?? {};
    const moduleIds = new Set([...Object.keys(beforeModules), ...Object.keys(afterModules)]);

    for (const moduleId of moduleIds) {
      const beforeActions = beforeModules[moduleId] ?? [];
      const afterActions = afterModules[moduleId] ?? [];
      const same = beforeActions.length === afterActions.length && beforeActions.every((action, index) => action === afterActions[index]);

      if (!same) {
        changes.push({ roleId, moduleId, before: beforeActions, after: afterActions });
      }
    }
  }

  return changes;
}

export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const snapshot = await getOrganizationRolePermissionsSnapshot(user.organizationId);
  const response = NextResponse.json(snapshot);
  response.headers.append("Set-Cookie", buildPermissionsCookie(snapshot.permissions));

  return response;
}

export async function PUT(request: Request) {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canManagePermissions(user.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json()) as { permissions?: unknown };
  const before = await getOrganizationRolePermissionsSnapshot(user.organizationId);
  const snapshot = await saveOrganizationRolePermissions(user.organizationId, body.permissions);
  const changes = diffPermissions(before.permissions, snapshot.permissions);

  if (changes.length) {
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "update_role_permissions",
        entityType: "OrganizationRolePermission",
        entityId: user.organizationId,
        metadata: {
          revision: snapshot.revision,
          changes,
        },
      },
    });
  }

  const response = NextResponse.json(snapshot);
  response.headers.append("Set-Cookie", buildPermissionsCookie(snapshot.permissions));

  return response;
}
