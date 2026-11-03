import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { syncDomains, syncCenterEnabled, SyncInputError, requireSyncCenter, requiredText } from "@/lib/amazon-sync/policy";
import { listSources, readOverview, readTasks, taskSummary } from "@/lib/amazon-sync/read";
import { controlTask, disableAuthorization, listAuthorizations, requestTasks, saveAuthorization, savePlan, saveSource, validateAuthorization } from "@/lib/amazon-sync/service";
export const runtime = "nodejs";
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function fail(error: unknown) {
  if (error instanceof SyncInputError) return json({ error: error.message }, error.status);
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") return json({ error: "数据已存在或有活动任务冲突，请刷新。" }, 409);
  return json({ error: "同步中心请求失败，请检查数据库、加密配置或 Amazon 授权。未返回内部错误或凭证。" }, 500);
}
export async function GET(request: Request) {
  const permission = await requireApiPermission("operations", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    if (!syncCenterEnabled(scope)) return json({ error: "该范围尚未启用同步中心。", code: "SYNC_CENTER_DISABLED" }, 409);
    if (!process.env.DATABASE_URL) return json({ error: "数据库未配置。" }, 503);
    const p = new URL(request.url).searchParams, section = p.get("section") ?? "overview";
    const permissions = await getOrganizationRolePermissions(scope.organizationId);
    const access = { canEdit: roleCanPerformAction(permission.user.role, "operations", "edit", permissions), canCreate: roleCanPerformAction(permission.user.role, "operations", "create", permissions), canConfigure: roleCanPerformAction(permission.user.role, "settings", "edit", permissions) };
    if (section === "overview") return json({ ...await readOverview(scope, p), access, domains: syncDomains });
    if (section === "sources") return json({ sources: await listSources(scope), access, domains: syncDomains });
    if (section === "plans") return json({ plans: await prisma.amazonSyncSchedule.findMany({ where: { ...scope, executionVersion: 2 }, include: { targets: { select: { sourceId: true } } }, orderBy: { createdAt: "asc" }, take: 201 }), sources: await listSources(scope), access });
    if (section === "tasks") return json({ ...await readTasks(scope, p), access });
    if (section === "task") {
      const id = requiredText(p.get("id"), "任务 ID");
      const task = await prisma.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2 } });
      if (!task) return json({ error: "任务不存在。" }, 404);
      const after = p.get("after"), logPage = Math.max(0, Math.min(10000, Math.floor(Number(after) || 0)));
      const logs = await prisma.amazonSyncTaskLog.findMany({ where: { ...scope, taskId: id }, select: { id: true, attempt: true, event: true, stage: true, page: true, code: true, requestId: true, statusCode: true, rateLimit: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: logPage, take: 101 });
      const source = task.sourceId ? (await listSources(scope)).find(s => s.id === task.sourceId) : null;
      return json({ task: taskSummary(task), source, logs: logs.slice(0, 100), nextAfter: logs.length > 100 ? logPage + 100 : null, access });
    }
    if (section === "connections") return json({ authorizations: await listAuthorizations(scope), sources: await listSources(scope), sellers: access.canConfigure ? await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true, accountKey: true }, orderBy: { displayName: "asc" }, take: 201 }) : [], access });
    if (section === "settings") {
      const heartbeats = await prisma.workerHeartbeat.findMany({ where: { queueName: "amazon-sync-jobs", OR: [{ organizationId: scope.organizationId }, { organizationId: null }] }, select: { workerName: true, status: true, concurrency: true, lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 10 });
      return json({ heartbeats: heartbeats.map(w => ({ ...w, online: w.status === "online" && Date.now() - w.lastSeenAt.getTime() < 120000 })), queueConfigured: process.env.QUEUE_DRIVER === "redis", access });
    }
    throw new SyncInputError("未知页面。");
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { const value: unknown = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); body = value as Record<string, unknown>; }
  catch { return json({ error: "请求须为 JSON 对象。" }, 400); }
  const action = body.action;
  const config = ["save-authorization", "validate-authorization", "disable-authorization", "save-source"].includes(String(action));
  const permission = await requireApiPermission(config ? "settings" : "operations", config || action === "save-plan" || action === "control-task" ? "edit" : "create", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    requireSyncCenter(scope);
    if (!process.env.DATABASE_URL) return json({ error: "数据库未配置。" }, 503);
    const actor = permission.user.id;
    if (action === "save-authorization") return json({ authorization: await saveAuthorization(scope, actor, body) });
    if (action === "validate-authorization") return json({ authorization: await validateAuthorization(scope, actor, requiredText(body.id, "授权 ID")) });
    if (action === "disable-authorization") return json(await disableAuthorization(scope, actor, requiredText(body.id, "授权 ID"), body.revision));
    if (action === "save-source") return json({ source: await saveSource(scope, actor, body) });
    if ((action === "save-plan" && body.enabled === true) || (action === "control-task" && ["retry", "resume"].includes(String(body.control)))) {
      const create = await requireApiPermission("operations", "create", request); if (!create.ok) return create.response;
    }
    if (action === "save-plan") return json({ plan: await savePlan(scope, actor, body) });
    if (action === "run") {
      if (process.env.QUEUE_DRIVER !== "redis") return json({ error: "同步需要 Redis Worker，当前仅可管理停用计划。" }, 409);
      const tasks = await requestTasks(scope, actor, body); return json({ tasks: tasks.map(taskSummary) }, 202);
    }
    if (action === "control-task") return json({ task: taskSummary(await controlTask(scope, actor, requiredText(body.id, "任务 ID"), body.control)) }, 202);
    throw new SyncInputError("未知操作。");
  } catch (error) { return fail(error); }
}
