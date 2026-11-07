import { readObservations } from "@/lib/amazon-sync/observations-query";
import { readBrandAnalytics, readBrandAsins, readBrandAsinAnalysis } from "@/lib/amazon-sync/brand-analytics-query";
import { readReturns } from "@/lib/amazon-sync/returns-query";
import { readFinance } from "@/lib/amazon-sync/finance-query";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { amazonDataAccess, sourceAccessWhere, assertAmazonScopeAdmin } from "@/lib/amazon-sync/data-access";
import { readSalesTraffic } from "@/lib/amazon-sync/sales-query";
import { readOrders } from "@/lib/amazon-sync/orders-query";
import { readDomainReports } from "@/lib/amazon-sync/domain-reports-query";
import { readSellerReportEvidence } from "@/lib/amazon-sync/seller-report-evidence";
import { localSellerEvidenceEnabled } from "@/lib/amazon-sync/seller-report-evidence";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { prisma } from "@/lib/db/prisma";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { syncDomains, syncCenterEnabled, SyncInputError, requireSyncCenter, requiredText } from "@/lib/amazon-sync/policy";
import { readTaskSnapshot } from "@/lib/amazon-sync/snapshots";
import { listSources, readOverview, readTasks, taskSummary } from "@/lib/amazon-sync/read";
import { listAuthorizations } from "@/lib/amazon-sync/service";
import { requestChange, approvalSelect } from "@/lib/amazon-sync/change-approval";
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
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(scope.organizationId, scope.workspaceId))) return json({ error: "Forbidden." }, 403);
    if (!syncCenterEnabled(scope)) return json({ error: "该范围尚未启用同步中心。", code: "SYNC_CENTER_DISABLED" }, 409);
    if (!process.env.DATABASE_URL) return json({ error: "数据库未配置。" }, 503);
    const actor = permission.user.id;
    await auditAmazonDataRead(scope, actor, "sync-center", permission.user.role);
    const dataAccess = await amazonDataAccess(scope, actor), sellerWhere = sourceAccessWhere(dataAccess);
    const allowedSources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sellerWhere }, select: { id: true } });
    const sourceIds = allowedSources.map(s => s.id);
    const p = new URL(request.url).searchParams, section = p.get("section") ?? "overview";
    const permissions = await getOrganizationRolePermissions(scope.organizationId);
    const access = { canExport: roleCanPerformAction(permission.user.role, "operations", "export", permissions), canApprove: roleCanPerformAction(permission.user.role, "operations", "approve", permissions), canEdit: roleCanPerformAction(permission.user.role, "operations", "edit", permissions), canCreate: roleCanPerformAction(permission.user.role, "operations", "create", permissions), canConfigure: dataAccess.allSellers && roleCanPerformAction(permission.user.role, "settings", "edit", permissions) };
    if (section === "sales-traffic") return json({ ...await readSalesTraffic(scope, p, { actor }), access });
    if (section === "returns") return json({ ...await readReturns(scope, p, actor), access });
    if (section === "finance") return json({ ...await readFinance(scope, p, actor), access });
    if (section === "orders") return json({ ...await readOrders(scope, p, actor), access });
    if (section === "observations") return json({ ...await readObservations(scope, p, actor), access });
    if (section === "brand-analytics") return json({ ...await readBrandAnalytics(scope, p, actor), access });
    if (section === "brand-asin-analysis") return json(await readBrandAsinAnalysis(scope, p, actor));
    if (section === "brand-asins") return json(await readBrandAsins(scope, p.get("sourceId") ?? "", actor));
    if (section === "seller-report-evidence") return json(await readSellerReportEvidence(scope, p, actor));
    if (section === "domain-reports") {
      try { return json({ ...await readDomainReports(scope, p, actor), access }); }
      catch (error) {
        if (localSellerEvidenceEnabled(scope)) console.error("AMAZON_REPORT_READ_FAILED", { name: error instanceof Error ? error.name : "Unknown", field: error instanceof Error ? /Unknown (?:field|argument) `([A-Za-z0-9_]+)`/.exec(error.message)?.[1] : undefined, code: error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 40) : undefined });
        throw error;
      }
    }
    if (section === "approvals") return json({ requests: await prisma.amazonDataCenterChangeRequest.findMany({ where: { ...scope, ...(dataAccess.allSellers ? {} : { requestedByUserId: actor, sourceIds: { hasSome: sourceIds } }) }, select: approvalSelect, orderBy: { createdAt: "desc" }, take: 200 }).then(rows => rows.filter(row => dataAccess.allSellers || row.sourceIds.every(id => sourceIds.includes(id)))), access });
    if (section === "overview") return json({ ...await readOverview(scope, p, actor), access, domains: syncDomains });
    if (section === "sources" || section === "domains") return json({ sources: await listSources(scope, { ...(p.get("sellerAccountId") ? { sellerAccountId: p.get("sellerAccountId")!.slice(0, 200) } : {}), ...(p.get("marketplaceId") ? { marketplaceId: p.get("marketplaceId")!.slice(0, 200) } : {}), ...(p.get("resource") ? { resource: p.get("resource")!.slice(0, 200) } : {}) }, actor), access, domains: syncDomains });
    if (section === "plans") return json({ plans: await prisma.amazonSyncSchedule.findMany({ where: { ...scope, executionVersion: 2, ...(dataAccess.allSellers ? {} : { targets: { some: { sourceId: { in: sourceIds } }, every: { sourceId: { in: sourceIds } } } }) }, include: { targets: { select: { sourceId: true } } }, orderBy: { createdAt: "asc" }, take: 201 }), sources: await listSources(scope, {}, actor), access });
    if (section === "snapshots") return json({ ...await readTaskSnapshot(scope, p, actor), access });
    if (section === "tasks") return json({ ...await readTasks(scope, p, actor), access });
    if (section === "task") {
      const id = requiredText(p.get("id"), "任务 ID");
      const task = await prisma.amazonSyncRun.findFirst({ where: { ...scope, id, executionVersion: 2, sourceId: { in: sourceIds } } });
      if (!task) return json({ error: "任务不存在。" }, 404);
      const after = p.get("after"), logPage = Math.max(0, Math.min(10000, Math.floor(Number(after) || 0)));
      const logs = await prisma.amazonSyncTaskLog.findMany({ where: { ...scope, taskId: id }, select: { id: true, attempt: true, event: true, stage: true, page: true, code: true, requestId: true, statusCode: true, rateLimit: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: logPage, take: 101 });
      const source = task.sourceId ? (await listSources(scope, {}, actor)).find(s => s.id === task.sourceId) : null;
      return json({ task: taskSummary(task), source, logs: logs.slice(0, 100), nextAfter: logs.length > 100 ? logPage + 100 : null, access });
    }
    if (section === "access-grants") { await assertAmazonScopeAdmin(scope, actor); return json({ grants: await prisma.amazonDataAccessGrant.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 200 }), access }); }
    if (section === "connections") { await assertAmazonScopeAdmin(scope, actor); return json({ roleGrants: await prisma.amazonRoleDataAccessGrant.findMany({ where: scope, take: 200 }), grantRoles: await prisma.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, take: 200 }), grants: await prisma.amazonDataAccessGrant.findMany({ where: scope, take: 200, orderBy: { createdAt: "desc" } }), grantMembers: await prisma.organizationMember.findMany({ where: { organizationId: scope.organizationId, user: { status: "active" } }, select: { userId: true, user: { select: { name: true } } }, take: 200 }), authorizations: await listAuthorizations(scope), sources: await listSources(scope, {}, actor), sellers: access.canConfigure ? await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true, displayName: true, accountKey: true }, orderBy: { displayName: "asc" }, take: 201 }) : [], access }); }
    if (section === "settings") {
      const heartbeats = await prisma.workerHeartbeat.findMany({ where: { queueName: "amazon-data-center-jobs", OR: [{ organizationId: scope.organizationId }, { organizationId: null }] }, select: { workerName: true, status: true, concurrency: true, lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 10 });
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
  const config = ["save-authorization", "validate-authorization", "disable-authorization", "save-source", "save-access-grant", "adopt-identity", "recover-finance-window", "recover-report"].includes(String(action));
  const permission = await requireApiPermission(config ? "settings" : "operations", config || action === "save-plan" || action === "control-task" ? "edit" : "create", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(scope.organizationId, scope.workspaceId))) return json({ error: "Forbidden." }, 403);
    requireSyncCenter(scope);
    if (!process.env.DATABASE_URL) return json({ error: "数据库未配置。" }, 503);
    const actor = permission.user.id;
    const change = await requestChange(scope, actor, body);
    return json({ approvalRequired: true, changeRequest: change }, 202);
  } catch (error) { return fail(error); }
}
