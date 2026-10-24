import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { applyAmazonAction } from "@/lib/agent-platform/amazon-action-audit";
import { AmazonActionError } from "@/lib/agent-platform/amazon-action-policy";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ auditId: string }> }) {
  const permission = await requireApiPermission("agents", "approve", request);
  if (!permission.ok) return permission.response;
  try {
    const { auditId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const scope = workspaceScopeFromRequest(request);
    const result = await applyAmazonAction({ organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, actorUserId: permission.user.id }, auditId, body.idempotencyKey);
    const execution = result.execution as { code?: string; status?: string };
    return NextResponse.json(result, { status: execution.code === "NOT_IMPLEMENTED" ? 501 : execution.status === "FAILED" ? 409 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ code: error instanceof AmazonActionError ? error.code : "APPLY_FAILED", error: error instanceof AmazonActionError ? error.message : "执行请求失败，未报告 Amazon 写入成功。" }, { status: error instanceof AmazonActionError ? error.status : 500 });
  }
}
