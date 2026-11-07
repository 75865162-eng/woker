import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { decideChange, applyChange } from "@/lib/amazon-sync/change-approval";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { requireSyncCenter, requiredText, SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  // Applying requires the original operation permission, checked again from persisted membership.
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyncInputError("请求须为 JSON 对象。");
    const input = body as Record<string, unknown>;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, input).workspaceId };
    requireSyncCenter(scope);
    const id = requiredText(input.id, "审批 ID");
    if (input.decision === "APPLY") return json(await applyChange(scope, permission.user.id, id));
    if (!["APPROVED", "REJECTED", "REVOKED"].includes(String(input.decision))) throw new SyncInputError("审批操作无效。");
    const reason = input.reason === undefined ? "" : requiredText(input.reason, "原因", 200);
    return json({ request: await decideChange(scope, permission.user.id, id, input.decision as "APPROVED" | "REJECTED" | "REVOKED", reason) });
  } catch (error) { return json({ error: error instanceof SyncInputError ? error.message : "审批操作失败，未返回内部错误。" }, error instanceof SyncInputError ? error.status : 500); }
}
