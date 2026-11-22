import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getRunStatus } from "@/lib/ai-chat/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; runId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  const { runId } = await params;
  const run = await getRunStatus({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id }, runId);
  if (!run) return NextResponse.json({ error: "执行记录不存在。" }, { status: 404 });
  return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
}
