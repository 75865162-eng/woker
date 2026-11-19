import { AmazonCloudExecutionError } from "@/lib/amazon/execution-role";
import { NextResponse } from "next/server";
import { boundedJsonObjectWithRaw } from "@/lib/amazon-sync/request-body";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { startAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    // Validate body-bound security checks (origin/JSON/size) before session parsing,
    // then rebuild an equivalent Request from the raw text so requireApiPermission
    // can still parse workspace selectors from a fresh, unread body.
    const { value: body, raw } = await boundedJsonObjectWithRaw(request, 1024);
    const authRequest = new Request(request.url, { method: request.method, headers: request.headers, body: raw });
    const permission = await requireApiPermission("settings", "edit", authRequest);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(authRequest).workspaceId };
    if (typeof body.region !== "string") throw new SyncInputError("区域无效。");
    return NextResponse.json(await startAmazonOAuth(scope, permission.user.id, body.region), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ ...(e instanceof AmazonCloudExecutionError ? { code: e.code } : {}), error: e instanceof SyncInputError ? e.message : "无法开始 Amazon 授权。" }, { status: e instanceof SyncInputError ? e.status : 500, headers: { "Cache-Control": "no-store" } }); }
}
