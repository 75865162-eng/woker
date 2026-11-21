import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readApprovalCenter, type ApprovalView } from "@/lib/approvals/center-read";

export const runtime = "nodejs";

/**
 * 统一审批中心（只读聚合）。审批动作仍走各域现有端点，禁自批/revision/hash 校验不在这里绕过。
 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;

  const url = new URL(request.url);
  const view: ApprovalView = url.searchParams.get("view") === "myRequests" ? "myRequests" : "toReview";
  const workspaceId = workspaceScopeFromRequest(request).workspaceId;

  try {
    const data = await readApprovalCenter(
      { organizationId: permission.user.organizationId, workspaceId, userId: permission.user.id },
      view,
    );
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "读取审批中心失败，请稍后重试。" }, { status: 500 });
  }
}
