import { NextResponse } from "next/server";
import { rolePermissionsCookieName } from "@/lib/accounts/permissions";
import { getOrganizationRolePermissions, saveOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function canManagePermissions(role: string) {
  return role === "owner" || role === "database_admin";
}

function buildPermissionsCookie(permissions: unknown) {
  return `${rolePermissionsCookieName}=${encodeURIComponent(JSON.stringify(permissions))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const permissions = await getOrganizationRolePermissions(user.organizationId);
  const response = NextResponse.json({ permissions });
  response.headers.append("Set-Cookie", buildPermissionsCookie(permissions));

  return response;
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!canManagePermissions(user.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json()) as { permissions?: unknown };
  const permissions = await saveOrganizationRolePermissions(user.organizationId, body.permissions);

  await prisma.userSession.deleteMany({
    where: {
      userId: {
        not: user.id,
      },
      user: {
        memberships: {
          some: {
            organizationId: user.organizationId,
          },
        },
      },
    },
  });

  const response = NextResponse.json({ permissions });
  response.headers.append("Set-Cookie", buildPermissionsCookie(permissions));

  return response;
}
