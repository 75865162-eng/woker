import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { type CurrentUser } from "@/lib/auth/session";

/** 授权中心写权限：owner / database_admin（文档 §8.6：仅超级管理员可编辑授权）。 */
const EDIT_ROLES = new Set(["owner", "database_admin"]);

export type AccessGuardResult =
  | { ok: true; user: CurrentUser; workspaceId: string }
  | { ok: false; response: NextResponse };

function resolveWorkspaceId(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("workspaceId")?.trim() || request.headers.get("x-workspace-id")?.trim() || "default";
}

export async function requireAccessView(request: Request): Promise<AccessGuardResult> {
  const permission = await requireApiPermission("accounts", "view", request);
  if (!permission.ok) return permission;
  return { ok: true, user: permission.user, workspaceId: resolveWorkspaceId(request) };
}

export async function requireAccessEdit(request: Request): Promise<AccessGuardResult> {
  const permission = await requireApiPermission("accounts", "edit", request);
  if (!permission.ok) return permission;
  if (!EDIT_ROLES.has(permission.user.role)) {
    return { ok: false, response: NextResponse.json({ error: "仅 owner / database_admin 可编辑授权。" }, { status: 403 }) };
  }
  return { ok: true, user: permission.user, workspaceId: resolveWorkspaceId(request) };
}
