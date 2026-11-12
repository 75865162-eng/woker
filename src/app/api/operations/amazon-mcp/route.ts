import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { listMcpScopeOptions, listMcpSkillTableOptions, listMcpCredentials, manageMcpCredential, amazonMcpTools, amazonMcpToolCatalog, getMcpSettingsSnapshot, mcpCallLogFailureClasses } from "@/lib/amazon-sync/mcp";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request, write: boolean) {
  try {
    const body = write ? await boundedJsonObject(request, 16000) : undefined;
    const permission = await requireAmazonReadSession(request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (!write) {
      const params = new URL(request.url).searchParams;
      const parsePage = (name: string, fallback: number, max: number) => {
        const raw = params.get(name);
        if (raw === null) return fallback;
        const value = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) throw new SyncInputError("MCP 调用记录分页参数无效。", 400);
        return value;
      };
      const callLogStatus = params.get("callLogStatus")?.trim().toUpperCase();
      if (callLogStatus && !["SUCCEEDED", "DENIED"].includes(callLogStatus)) throw new SyncInputError("MCP 调用记录状态筛选无效。", 400);
      const callLogFailureClass = params.get("callLogFailureClass")?.trim().toUpperCase();
      if (callLogFailureClass && !mcpCallLogFailureClasses.includes(callLogFailureClass as typeof mcpCallLogFailureClasses[number])) throw new SyncInputError("MCP 调用失败分类筛选无效。", 400);
      const callLogTool = params.get("callLogTool")?.trim() || undefined;
      return json({ credentials: await listMcpCredentials(scope, permission.user.id), scopes: await listMcpScopeOptions(scope, permission.user.id), tables: await listMcpSkillTableOptions(scope, permission.user.id), tools: amazonMcpTools, toolCatalog: amazonMcpToolCatalog, status: await getMcpSettingsSnapshot(scope, permission.user.id, { callLogPage: parsePage("callLogPage", 1, 10000), callLogPageSize: parsePage("callLogPageSize", 20, 100), callLogStatus: callLogStatus as "SUCCEEDED" | "DENIED" | undefined, callLogFailureClass: callLogFailureClass as typeof mcpCallLogFailureClasses[number] | undefined, callLogTool }) });
    }
    return json(await manageMcpCredential(scope, permission.user.id, body!));
  } catch (e) { return json({ error: e instanceof SyncInputError ? e.message : "MCP 凭证操作失败。" }, e instanceof SyncInputError ? e.status : 500); }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
