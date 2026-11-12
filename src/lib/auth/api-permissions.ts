import { NextResponse } from "next/server";
import { roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { type CurrentUser } from "@/lib/auth/session";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { assertWorkspaceAccess } from "@/lib/workspace/access";

export type ApiPermissionResult =
  | {
      ok: true;
      user: CurrentUser;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireApiPermission(moduleId: string, action: PermissionAction, request?: Request): Promise<ApiPermissionResult> {
  const authorization = await getAuthorizationContext(request);
  const user = authorization?.user;

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const permissions = authorization!.permissions;

  if (!roleCanPerformAction(user.role, moduleId, action, permissions)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  // Workspace selectors are untrusted input. Cookies never grant authorization.
  if (request) {
    let bodyWorkspaceId: unknown;
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await request.clone().json() as Record<string, unknown>;
        const context = body?.context && typeof body.context === "object" ? body.context as Record<string, unknown> : undefined;
        bodyWorkspaceId = body?.workspaceId ?? context?.workspaceId;
      } catch {
        // The route owns malformed body handling.
      }
    }
    const requestedWorkspaceId = typeof bodyWorkspaceId === "string"
      ? bodyWorkspaceId
      : new URL(request.url).searchParams.get("workspaceId") || request.headers.get("x-workspace-id");
    if (requestedWorkspaceId && !(await assertWorkspaceAccess(user.organizationId, requestedWorkspaceId))) {
      return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
    }
  }

  return {
    ok: true,
    user,
  };
}
