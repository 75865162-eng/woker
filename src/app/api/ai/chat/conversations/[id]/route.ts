import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { deleteConversation, getConversation, renameConversation, ChatAccessError } from "@/lib/ai-chat/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  const { id } = await params;
  try {
    const data = await getConversation({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id }, id);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ChatAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取失败。" }, { status });
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const updated = await renameConversation(
      { organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id },
      id, String(body.title ?? ""), Number(body.revision),
    );
    return NextResponse.json({ conversation: updated });
  } catch (error) {
    const status = error instanceof ChatAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败。" }, { status });
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  const { id } = await params;
  try {
    const result = await deleteConversation({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id }, id);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ChatAccessError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败。" }, { status });
  }
}
