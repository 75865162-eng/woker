import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { cancelRun } from "@/lib/ai-chat/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; runId: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  const { runId } = await params;
  const result = await cancelRun({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id }, runId);
  if (result === "not_found") return NextResponse.json({ error: "执行记录不存在。" }, { status: 404 });
  return NextResponse.json({ result });
}
