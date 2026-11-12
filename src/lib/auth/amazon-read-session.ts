import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "./session";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import type { ApiPermissionResult } from "./api-permissions";

/** Identity gate only. Each Amazon query service validates the live account assignment. */
export async function requireAmazonReadSession(request: Request): Promise<ApiPermissionResult> {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  let body: Record<string, unknown> | undefined;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try { body = await request.clone().json(); } catch { /* The bounded route parser owns malformed input. */ }
  }
  const { workspaceId } = workspaceScopeFromRequest(request, body);
  if (process.env.DATABASE_URL && !await assertWorkspaceAccess(user.organizationId, workspaceId)) return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  return { ok: true, user };
}
