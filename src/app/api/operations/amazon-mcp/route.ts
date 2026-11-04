import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { listMcpScopeOptions, listMcpCredentials, manageMcpCredential, amazonMcpTools } from "@/lib/amazon-sync/mcp";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, write: boolean) {
  try {
    const body = write ? await boundedJsonObject(request, 16000) : undefined;
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (!write) return json({ credentials: await listMcpCredentials(scope, permission.user.id), scopes: await listMcpScopeOptions(scope, permission.user.id), tools: amazonMcpTools });
    return json(await manageMcpCredential(scope, permission.user.id, body!));
  } catch (e) { return json({ error: e instanceof SyncInputError ? e.message : "MCP 凭证操作失败。" }, e instanceof SyncInputError ? e.status : 500); }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
