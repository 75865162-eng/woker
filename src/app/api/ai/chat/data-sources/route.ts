import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getChatDataSourceSnapshot, saveChatDataSourceConfig } from "@/lib/ai-chat/data-sources";
import type { ChatScope } from "@/lib/ai-chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const ws = workspaceScopeFromRequest(request);
  const scope: ChatScope = { organizationId: user.organizationId, workspaceId: ws.workspaceId, userId: user.id };
  try {
    const snapshot = await getChatDataSourceSnapshot(scope);
    return NextResponse.json(snapshot, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "读取数据源配置失败。" }, { status: 500, headers: noStore });
  }
}

export async function PUT(request: Request) {
  const permission = await requireApiPermission("agents", "create", request);
  if (!permission.ok) return permission.response;
  const { user } = permission;
  const ws = workspaceScopeFromRequest(request, (await request.clone().json().catch(() => ({}))) as Record<string, unknown>);
  const scope: ChatScope = { organizationId: user.organizationId, workspaceId: ws.workspaceId, userId: user.id };
  try {
    const body = await request.json() as { enabledProviders?: unknown };
    const snapshot = await saveChatDataSourceConfig(scope, body.enabledProviders ?? []);
    return NextResponse.json(snapshot, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "保存数据源配置失败。" }, { status: 500, headers: noStore });
  }
}
