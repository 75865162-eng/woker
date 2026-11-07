import { NextResponse } from "next/server";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { createPairing, listDevices, revokeDevice } from "@/lib/lili/device-pairing";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
async function handle(request: Request) {
 try {
  const body = request.method === "POST" ? await boundedJsonObject(request, 2048) : undefined;
  let boundIdentity: { id: string; workspaceId: string } | undefined;
  const permission = request.headers.has("authorization") ? await (async () => {
    const { authenticateAmazonMcp } = await import("@/lib/amazon-sync/mcp");
    const { researchBearerDependencies } = await import("@/lib/lili/research-bearer-server");
    const identity = await authenticateAmazonMcp(request.headers.get("authorization"));
    boundIdentity = identity;
    return researchBearerDependencies.permission(identity, "settings", body ? "edit" : "view", request);
  })() : await requireApiPermission("settings", body ? "edit" : "view", request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: boundIdentity?.workspaceId ?? workspaceScopeFromRequest(request).workspaceId };
  const actor = permission.user.id;
  // An existing Bearer can only pair its own exact grant and manage its direct children.
  // It cannot select another, more privileged credential owned by the same user.
  const devices = boundIdentity ? await listDevices(scope, actor, boundIdentity.id) : undefined;
  let result;
  if (!body) result = { devices: devices ?? await listDevices(scope, actor) };
  else if (body.action === "pair" && typeof body.credentialId === "string") {
    if (boundIdentity && body.credentialId !== boundIdentity.id) throw new SyncInputError("凭证范围不可访问。", 403);
    result = await createPairing(scope, actor, body.credentialId);
  } else if (body.action === "revoke" && typeof body.id === "string") {
    if (boundIdentity && !devices?.some(device => device.id === body.id)) throw new SyncInputError("设备不可访问。", 403);
    result = await revokeDevice(scope, actor, body.id);
  } else throw new SyncInputError("参数无效。", 400);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
 } catch (error) { return NextResponse.json({ error: error instanceof SyncInputError ? error.message : "设备操作失败。" }, { status: error instanceof SyncInputError ? error.status : 503, headers: { "Cache-Control": "no-store" } }); }
}
export const GET = handle;
export const POST = handle;
