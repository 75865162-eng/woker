import { NextResponse } from "next/server";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

export type ApiPermissionResult =
  | {
      ok: true;
      user: CurrentUser;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireApiPermission(request: Request, moduleId: string, action: PermissionAction): Promise<ApiPermissionResult> {
  const user = await getCurrentUser(request);

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
