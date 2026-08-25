import { NextResponse } from "next/server";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { getCurrentUser, getCurrentUserFromRequest, type CurrentUser } from "@/lib/auth/session";

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
  const user = request ? await getCurrentUserFromRequest(request) : await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const permissions = await getOrganizationRolePermissions(user.organizationId);

  if (!roleCanPerformAction(user.role, moduleId, action, permissions)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
  };
}
