import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { isSellfoxDate, sellfoxSyncResources } from "@/lib/sellfox/sync-contract";
import { planSellfoxFullSync } from "@/lib/sellfox/sync-orchestrator";

export const runtime = "nodejs";

/** 一键全量：内置资源 + 已启用端点，按同步规则注册表自动分块并交给队列。 */
export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  if (process.env.QUEUE_DRIVER !== "redis") return NextResponse.json({ error: "赛狐异步同步 Worker 未启用。" }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { from, to, resources, endpointCodes } = body ?? {};
  if (from !== undefined && (typeof from !== "string" || !isSellfoxDate(from))) return NextResponse.json({ error: "起始日期无效。" }, { status: 400 });
  if (to !== undefined && (typeof to !== "string" || !isSellfoxDate(to))) return NextResponse.json({ error: "结束日期无效。" }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "起始日期不得晚于结束日期。" }, { status: 400 });
  if (resources !== undefined && (!Array.isArray(resources) || resources.some((item) => typeof item !== "string" || !sellfoxSyncResources.includes(item as (typeof sellfoxSyncResources)[number])))) return NextResponse.json({ error: "资源清单无效。" }, { status: 400 });
  if (endpointCodes !== undefined && (!Array.isArray(endpointCodes) || endpointCodes.some((item) => typeof item !== "string" || !item.trim()))) return NextResponse.json({ error: "端点清单无效。" }, { status: 400 });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, userId: permission.user.id };
  try {
    const plan = await planSellfoxFullSync(scope, {
      from: from as string | undefined, to: to as string | undefined,
      resources: resources as string[] | undefined, endpointCodes: endpointCodes as string[] | undefined,
    });
    return NextResponse.json({ ok: true, plan }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "全量计划生成失败。" }, { status: 400 });
  }
}
