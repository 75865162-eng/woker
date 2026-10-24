import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";

export const runtime = "nodejs";
const intervals = { stores: 480, inventory: 180, sales: 1440, performance: 1440 } as const;
type ScheduledResource = keyof typeof intervals;

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const scope = workspaceScopeFromRequest(request);
  const schedules = await prisma.sellfoxSyncSchedule.findMany({ where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId } });
  return NextResponse.json({ schedules: Object.entries(intervals).map(([resource, intervalMinutes]) => {
    const schedule = schedules.find((item) => item.resource === resource);
    return { resource, enabled: schedule?.enabled ?? false, intervalMinutes, disabledReason: sellfoxSyncDisabledReason(resource) };
  }) });
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  if (process.env.QUEUE_DRIVER !== "redis") return NextResponse.json({ error: "赛狐 Redis Worker 尚未启用。" }, { status: 503 });
  const body = await request.json().catch(() => null) as { resource?: unknown; enabled?: unknown } | null;
  if (typeof body?.resource !== "string" || !Object.prototype.hasOwnProperty.call(intervals, body.resource) || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "无效的定时同步设置。" }, { status: 400 });
  }
  const scope = workspaceScopeFromRequest(request);
  const resource = body.resource as ScheduledResource;
  const disabledReason = sellfoxSyncDisabledReason(resource);
  if (body.enabled && disabledReason) return NextResponse.json({ error: disabledReason }, { status: 409 });
  const id = `sellfox-schedule-${permission.user.organizationId}-${scope.workspaceId}-${resource}`;
  const schedule = await prisma.sellfoxSyncSchedule.upsert({
    where: { organizationId_workspaceId_resource: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, resource } },
    create: { id: `${id}-${randomUUID()}`, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, userId: permission.user.id, resource, intervalMinutes: intervals[resource], enabled: body.enabled, updatedAt: new Date() },
    update: { userId: permission.user.id, intervalMinutes: intervals[resource], enabled: body.enabled },
  });
  return NextResponse.json({ resource: schedule.resource, enabled: schedule.enabled, intervalMinutes: schedule.intervalMinutes });
}
