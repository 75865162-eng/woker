import { NextResponse } from "next/server";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { startAmazonOAuth } from "@/lib/amazon-sync/oauth";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await boundedJsonObject(request, 1024);
    const permission = await requireApiPermission("settings", "edit", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (typeof body.region !== "string") throw new SyncInputError("区域无效。");
    return NextResponse.json(await startAmazonOAuth(scope, permission.user.id, body.region), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof SyncInputError ? e.message : "无法开始 Amazon 授权。" }, { status: e instanceof SyncInputError ? e.status : 500, headers: { "Cache-Control": "no-store" } }); }
}
