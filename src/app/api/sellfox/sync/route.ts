import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { enqueueSellfoxSyncRun } from "@/lib/queue";
import { prisma } from "@/lib/db/prisma";
import { isSellfoxSyncResource, normalizeSellfoxDates, sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  if (!process.env.SELLFOX_CLIENT_ID || !process.env.SELLFOX_CLIENT_SECRET) {
    return NextResponse.json({ error: "服务端未配置赛狐凭据。请联系管理员检查服务端环境变量。" }, { status: 503 });
  }
  if (process.env.QUEUE_DRIVER !== "redis") {
    return NextResponse.json({ error: "赛狐异步同步 Worker 未启用，请联系管理员。" }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = body?.resource;
  if (!isSellfoxSyncResource(resource)) {
    return NextResponse.json({ error: "请选择有效的赛狐同步资源。" }, { status: 400 });
  }
  const scope = workspaceScopeFromRequest(request);
  if (body?.shopExternalIds !== undefined && (!Array.isArray(body.shopExternalIds) || body.shopExternalIds.some((value) => typeof value !== "string" || !value.trim()))) {
    return NextResponse.json({ error: "shopExternalIds 必须是非空店铺 ID 数组。" }, { status: 400 });
  }
  const shopExternalIds = Array.isArray(body?.shopExternalIds) ? [...new Set(body.shopExternalIds.map((value) => (value as string).trim()))] : undefined;
  let dates: ReturnType<typeof normalizeSellfoxDates>;
  try { dates = normalizeSellfoxDates(resource, body ?? {}); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "同步日期无效。" }, { status: 400 }); }
  if (shopExternalIds?.length) {
    const count = await prisma.sellfoxStore.count({ where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, externalId: { in: shopExternalIds } } });
    if (count !== shopExternalIds.length) return NextResponse.json({ error: "所选店铺不属于当前工作区。" }, { status: 403 });
  }

  const disabledReason = sellfoxSyncDisabledReason(resource);
  if (disabledReason) {
    const runId = `sellfox-sync-${randomUUID()}`;
    await prisma.sellfoxSyncRun.create({ data: { id: runId, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, userId: permission.user.id, resource, status: "failed", error: disabledReason, summary: { shopExternalIds: shopExternalIds ?? [] }, finishedAt: new Date() } });
    return NextResponse.json({ error: disabledReason, runId }, { status: 409 });
  }

  const runId = `sellfox-sync-${randomUUID()}`;
  await prisma.sellfoxSyncRun.create({ data: {
    id: runId, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId,
    userId: permission.user.id, resource, status: "queued",
    summary: { shopExternalIds: shopExternalIds ?? [], ...dates, datesFrozen: true, requestVersion: 2 },
  } });
  try {
    await enqueueSellfoxSyncRun(runId);
  } catch {
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "failed", error: "无法将同步任务加入队列，请检查 Redis 与 Worker。", finishedAt: new Date() } });
    return NextResponse.json({ error: "无法启动赛狐同步队列，请联系管理员。", runId }, { status: 503 });
  }
  return NextResponse.json({ runId, status: "queued" }, { status: 202 });
}
