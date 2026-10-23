import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getSyncSchedules } from "@/lib/operations/schedules";
import { parseSchedulePatch } from "@/lib/operations/schedule-policy";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = workspaceScopeFromRequest(request);
    const edit = await requireApiPermission("operations", "edit", request);
    return NextResponse.json({ schedules: await getSyncSchedules(permission.user.organizationId, scope.workspaceId), canEdit: edit.ok }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "同步计划读取失败。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const permission = await requireApiPermission("operations", "edit", request);
  if (!permission.ok) return permission.response;
  let patch;
  try { patch = parseSchedulePatch(await request.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无效计划。" }, { status: 400 }); }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "数据库未配置。" }, { status: 503 });
  try {
    const scope = workspaceScopeFromRequest(request);
    const key = { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, resource: patch.resource };
    await prisma.amazonSyncSchedule.upsert({
      where: { organizationId_workspaceId_resource: key },
      create: { id: randomUUID(), ...key, ...patch, updatedByUserId: permission.user.id },
      update: { ...patch, lastEnqueuedAt: null, updatedByUserId: permission.user.id },
    });
    return NextResponse.json({ schedules: await getSyncSchedules(key.organizationId, key.workspaceId) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "同步计划保存失败。" }, { status: 500 }); }
}
