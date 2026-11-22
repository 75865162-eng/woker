import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { createConversation, listConversations } from "@/lib/ai-chat/repository";
import { ChatAccessError } from "@/lib/ai-chat/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  try {
    const conversations = await listConversations({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id });
    return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const scope = workspaceScopeFromRequest(request);
  let title = "新对话";
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.title === "string") title = body.title;
  } catch { /* 使用默认标题 */ }
  try {
    const conversation = await createConversation({ organizationId: user.organizationId, workspaceId: scope.workspaceId, userId: user.id }, title);
    return NextResponse.json({ conversation }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败。" }, { status: 500 });
  }
}
