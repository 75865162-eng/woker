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
    const workspaceIds: unknown[] = [];
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await request.clone().json() as Record<string, unknown>;
        const context = body?.context && typeof body.context === "object" ? body.context as Record<string, unknown> : undefined;
        if (body && Object.hasOwn(body, "workspaceId")) workspaceIds.push(body.workspaceId);
        if (context && Object.hasOwn(context, "workspaceId")) workspaceIds.push(context.workspaceId);
      } catch {
        // The route owns malformed body handling.
      }
    }
    workspaceIds.push(...new URL(request.url).searchParams.getAll("workspaceId"));
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    if (headerWorkspaceId !== null) workspaceIds.push(headerWorkspaceId);

    const checked = new Set<string>();
    for (const value of workspaceIds) {
      if (typeof value !== "string") {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
      const workspaceId = value.trim();
      if (checked.has(workspaceId)) continue;
      checked.add(workspaceId);
      // 四个选择器位置已足够；拒绝重复 query 参数放大数据库查询。
      if (checked.size > 4) {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
      if (!(await assertWorkspaceAccess(user.organizationId, workspaceId))) {
        return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
      }
    }
  }

  return {
    ok: true,
    user,
  };
}
