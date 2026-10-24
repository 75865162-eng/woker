import { sellfoxScheduleIntervals, nextSellfoxScheduleAt, sellfoxSyncScopeLock, defaultSellfoxBackfillStart } from "@/lib/sellfox/schedule-time";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { isSellfoxDate, sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";

export const runtime = "nodejs";
const intervals = sellfoxScheduleIntervals;
type ScheduledResource = keyof typeof intervals;

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const scope = workspaceScopeFromRequest(request);
  const schedules = await prisma.sellfoxSyncSchedule.findMany({ where: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId } });
  const now = new Date();
  const heartbeat = await prisma.workerHeartbeat.findFirst({ where: { queueName: "sellfox-sync-jobs" }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true, status: true } });
  const worker = { online: Boolean(heartbeat?.status === "online" && now.getTime() - heartbeat.lastSeenAt.getTime() <= 90_000), lastSeenAt: heartbeat?.lastSeenAt ?? null };
  return NextResponse.json({ configured: Boolean(process.env.SELLFOX_CLIENT_ID && process.env.SELLFOX_CLIENT_SECRET), queueEnabled: process.env.QUEUE_DRIVER === "redis", worker, schedules: Object.entries(intervals).map(([resource, intervalMinutes]) => {
    const schedule = schedules.find((item) => item.resource === resource);
    return { resource, enabled: schedule?.enabled ?? false, intervalMinutes, lastEnqueuedAt: schedule?.lastEnqueuedAt ?? null, backfillStart: schedule?.backfillStart ?? (resource === "sales" ? defaultSellfoxBackfillStart() : null), backfillNextDate: schedule?.backfillNextDate ?? null, nextRunAt: schedule?.enabled ? nextSellfoxScheduleAt(schedule, now).toISOString() : null, disabledReason: sellfoxSyncDisabledReason(resource) };
  }) });
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  if (process.env.QUEUE_DRIVER !== "redis") return NextResponse.json({ error: "赛狐 Redis Worker 尚未启用。" }, { status: 503 });
  const body = await request.json().catch(() => null) as { resource?: unknown; enabled?: unknown; backfillStart?: unknown } | null;
  if (typeof body?.resource !== "string" || !Object.prototype.hasOwnProperty.call(intervals, body.resource) || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "无效的定时同步设置。" }, { status: 400 });
  }
  if (body.enabled && (!process.env.SELLFOX_CLIENT_ID || !process.env.SELLFOX_CLIENT_SECRET)) return NextResponse.json({ error: "服务端未配置赛狐凭据。请联系管理员检查服务端环境变量。" }, { status: 503 });
  const scope = workspaceScopeFromRequest(request);
  const resource = body.resource as ScheduledResource;
  const disabledReason = sellfoxSyncDisabledReason(resource);
  if (body.enabled && disabledReason) return NextResponse.json({ error: disabledReason }, { status: 409 });
  if (body.backfillStart !== undefined && (resource !== "sales" || !isSellfoxDate(body.backfillStart))) return NextResponse.json({ error: "补数起始日无效。" }, { status: 400 });
  const backfillStart = resource === "sales" ? String(body.backfillStart ?? defaultSellfoxBackfillStart()) : null;
  const enabled = body.enabled;
  const id = `sellfox-schedule-${permission.user.organizationId}-${scope.workspaceId}-${resource}`;
  const schedule = await prisma.$transaction(async (tx) => {
    const lockKey = sellfoxSyncScopeLock(permission.user.organizationId, scope.workspaceId, resource);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const existing = await tx.sellfoxSyncSchedule.findUnique({ where: { organizationId_workspaceId_resource: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, resource } } });
    return tx.sellfoxSyncSchedule.upsert({
      where: { organizationId_workspaceId_resource: { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, resource } },
      create: { id: `${id}-${randomUUID()}`, organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, userId: permission.user.id, resource, intervalMinutes: intervals[resource], enabled, backfillStart, backfillNextDate: backfillStart, updatedAt: new Date() },
      update: { ...(resource === "sales" && ((body.backfillStart !== undefined && body.backfillStart !== existing?.backfillStart) || !existing?.backfillNextDate) ? { backfillStart, backfillNextDate: backfillStart } : {}), userId: permission.user.id, intervalMinutes: intervals[resource], enabled },
    });
  });
  return NextResponse.json({ resource: schedule.resource, enabled: schedule.enabled, intervalMinutes: schedule.intervalMinutes, lastEnqueuedAt: schedule.lastEnqueuedAt, nextRunAt: schedule.enabled ? nextSellfoxScheduleAt(schedule).toISOString() : null });
}
