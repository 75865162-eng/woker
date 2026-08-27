import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ensureOrganization } from "@/lib/organizations/organization-server";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const scopes = await prisma.workspaceScope.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    if (!scopes.some((scope) => scope.id === "default")) {
      await ensureOrganization(user.organizationId, user.organizationName);

      const defaultScope = await prisma.workspaceScope.create({
        data: {
          organizationId: user.organizationId,
          id: "default",
          name: "默认工作区",
          isDefault: true,
        },
      });

      return NextResponse.json({ workspaces: [defaultScope, ...scopes] });
    }

    return NextResponse.json({ workspaces: scopes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspaces.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as { workspaceId?: unknown; name?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = normalizeWorkspaceScope({
      workspaceId: body.workspaceId,
      accountId: body.accountId,
      marketplace: body.marketplace,
    });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : scope.workspaceId;

    const workspace = await prisma.workspaceScope.upsert({
      where: {
        organizationId_id: {
          organizationId: user.organizationId,
          id: scope.workspaceId,
        },
      },
      create: {
        organizationId: user.organizationId,
        id: scope.workspaceId,
        name,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        isDefault: scope.workspaceId === "default",
      },
      update: {
        name,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
      },
    });

    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save workspace.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
