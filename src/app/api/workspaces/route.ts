import { NextResponse } from "next/server";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { requireWorkspaceOwner } from "@/lib/workspace/memberships";
import { WorkspaceScopeError } from "@/lib/workspace/scope";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ensureOrganization } from "@/lib/organizations/organization-server";
import { isWorkspaceScopeComplete, normalizeWorkspaceScope } from "@/lib/workspace/scope";

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
        ...(user.role === "owner" ? {} : { memberships: { some: { userId: user.id } } }),
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    if (user.role === "owner" && !scopes.some((scope) => scope.id === "default")) {
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
    return NextResponse.json({ error: message }, { status: error instanceof WorkspaceScopeError ? error.status : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorizationContext(request);
    if (!authorization) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const { user } = authorization;
    await requireWorkspaceOwner(user.organizationId, user.id);

    const body = (await request.json()) as { workspaceId?: unknown; name?: unknown; accountId?: unknown; marketplace?: unknown };
    const scope = normalizeWorkspaceScope({
      workspaceId: body.workspaceId,
      accountId: body.accountId,
      marketplace: body.marketplace,
    }, { requireWorkspaceId: true });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : scope.workspaceId;

    if (!isWorkspaceScopeComplete(scope)) {
      return NextResponse.json({ error: "请补齐 workspaceId、accountId 和 marketplace 后再保存工作区。" }, { status: 400 });
    }

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
    return NextResponse.json({ error: message }, { status: error instanceof WorkspaceScopeError ? error.status : 500 });
  }
}
