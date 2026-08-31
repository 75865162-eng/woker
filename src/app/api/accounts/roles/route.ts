import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { getOrganizationRoleCatalogSnapshot, saveOrganizationRoleCatalog } from "@/lib/accounts/role-catalog-server";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function canManageRoles(role: string) {
  return role === "owner" || role === "database_admin";
}

function diffRoles(
  before: Array<{ id: string; name: string; description: string; permissions: unknown; sortOrder: number }>,
  after: Array<{ id: string; name: string; description: string; permissions: unknown; sortOrder: number }>,
) {
  const beforeMap = new Map(before.map((role) => [role.id, role]));
  const afterMap = new Map(after.map((role) => [role.id, role]));
  const roleIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: Array<Record<string, unknown>> = [];

  for (const roleId of roleIds) {
    const beforeRole = beforeMap.get(roleId);
    const afterRole = afterMap.get(roleId);

    if (!beforeRole && afterRole) {
      changes.push({ roleId, type: "create", after: afterRole });
      continue;
    }

    if (beforeRole && !afterRole) {
      changes.push({ roleId, type: "delete", before: beforeRole });
      continue;
    }

    if (!beforeRole || !afterRole) continue;

    if (
      beforeRole.name !== afterRole.name ||
      beforeRole.description !== afterRole.description ||
      beforeRole.sortOrder !== afterRole.sortOrder ||
      JSON.stringify(beforeRole.permissions) !== JSON.stringify(afterRole.permissions)
    ) {
      changes.push({ roleId, type: "update", before: beforeRole, after: afterRole });
    }
  }

  return changes;
}

export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const snapshot = await getOrganizationRoleCatalogSnapshot(user.organizationId);
  const response = NextResponse.json(snapshot);

  return response;
}

export async function PUT(request: Request) {
  const user = await getCurrentUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissions = await getOrganizationRolePermissions(user.organizationId);

  if (!roleCanPerformAction(user.role, "accounts", "edit", permissions) && !canManageRoles(user.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json()) as { roles?: unknown };
  const nextRoles = Array.isArray(body.roles) ? (body.roles as RoleCatalogItem[]) : [];
  const before = await getOrganizationRoleCatalogSnapshot(user.organizationId);
  const saved = await saveOrganizationRoleCatalog(user.organizationId, nextRoles);
  const changes = diffRoles(before.roles, saved.roles);

  if (changes.length) {
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: "update_roster_roles",
        entityType: "OrganizationRosterRole",
        entityId: user.organizationId,
        metadata: {
          revision: saved.revision,
          changes: JSON.parse(JSON.stringify(changes)),
        },
      },
    });
  }

  return NextResponse.json(saved);
}
