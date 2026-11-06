import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { cancelAdsTask, controlAdsPlan, runAdsPlanNow } from "@/lib/amazon-ads/sync-service";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess } from "@/lib/amazon-sync/data-access";
import { buildAdsProfileWhere } from "@/lib/amazon-ads/query-service";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const taskStatuses = new Set(["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "WAITING_FOR_ADAPTER", "WAITING_FOR_CONFIG"]);
function syncTaskQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const profileId = params.get("profileId")?.trim() || undefined;
  const taskId = params.get("taskId")?.trim() || undefined;
  if (profileId && profileId.length > 100) throw new SyncInputError("Profile 筛选参数无效。");
  if (taskId && taskId.length > 100) throw new SyncInputError("任务筛选参数无效。");
  const status = params.get("status")?.trim().toUpperCase() || undefined;
  if (status && !taskStatuses.has(status)) throw new SyncInputError("同步任务状态筛选无效。");
  const parse = (name: string, fallback: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) throw new SyncInputError("同步任务分页参数无效。");
    return value;
  };
  return { profileId, taskId, status, page: parse("page", 1, 10000), pageSize: parse("pageSize", 20, 100), attemptPage: parse("attemptPage", 1, 10000), attemptPageSize: parse("attemptPageSize", 10, 50) };
}
export async function GET(request: Request) {
  const permission = await requireApiPermission("settings", "view", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const query = syncTaskQuery(request);
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const access = await amazonDataAccess(scope, permission.user.id);
    const visibleProfile = buildAdsProfileWhere(scope, access, { profileRecordId: query.profileId });
    if (query.taskId) {
      const task = await prisma.amazonAdsSyncTask.findFirst({
        where: { ...scope, id: query.taskId, profile: { is: visibleProfile } },
        select: {
          id: true, planId: true, profileId: true, status: true, stage: true, trigger: true, attempts: true, maxAttempts: true,
          processedCount: true, insertedCount: true, updatedCount: true, failedCount: true, apiRequests: true, throttles: true,
          errorCode: true, requestedFrom: true, requestedTo: true, startedAt: true, finishedAt: true, createdAt: true,
          profile: { select: { profileId: true, region: true, countryCode: true, marketplaceId: true, sellerAccountId: true, currencyCode: true, timezone: true, authorization: { select: { name: true, status: true } } } },
          plan: { select: { id: true, status: true, intervalMinutes: true, reportLookbackDays: true, attributionLagDays: true } },
        },
      });
      if (!task) return NextResponse.json({ error: "同步任务不存在或不可访问。" }, { status: 404, headers });
      const attemptWhere = { ...scope, profileId: task.profileId, taskId: task.id };
      const sourceWhere = { ...scope, profileId: task.profileId, sourceTaskId: task.id };
      const [attemptTotal, attemptRuns, reportRequestTotal, reportRequestsRaw, reportVersionTotal, reportVersions, freshness] = await Promise.all([
        prisma.amazonAdsSyncAttempt.count({ where: attemptWhere }),
        prisma.amazonAdsSyncAttempt.findMany({ where: attemptWhere, orderBy: [{ attemptNumber: "asc" }, { id: "asc" }], skip: (query.attemptPage - 1) * query.attemptPageSize, take: query.attemptPageSize, select: { attemptNumber: true, stage: true, status: true, startedAt: true, finishedAt: true, retryAt: true, errorCode: true, safeErrorSummary: true, apiRequests: true, processedCount: true } }),
        prisma.amazonAdsReportRequest.count({ where: sourceWhere }),
        prisma.amazonAdsReportRequest.findMany({ where: sourceWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20, select: { id: true, versionId: true, reportType: true, adProduct: true, apiVersion: true, requestedFrom: true, requestedTo: true, status: true, warningCodes: true, errorCode: true, requestedAt: true, lastPolledAt: true, completedAt: true, documents: { orderBy: [{ partIndex: "asc" }], take: 10, select: { id: true, partIndex: true, format: true, compression: true, status: true, byteSize: true, rowCount: true, downloadedAt: true } }, _count: { select: { documents: true } } } }),
        prisma.amazonAdsReportVersion.count({ where: sourceWhere }),
        prisma.amazonAdsReportVersion.findMany({ where: sourceWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20, select: { id: true, status: true, requestedFrom: true, requestedTo: true, rowCount: true, publishedAt: true, createdAt: true, updatedAt: true } }),
        prisma.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId: task.profileId }, orderBy: [{ dataDomain: "asc" }, { reportType: "asc" }], select: { dataDomain: true, reportType: true, status: true, coveredFrom: true, coveredTo: true, lastAttemptAt: true, lastSuccessAt: true, lastTaskId: true, warningCodes: true } }),
      ]);
      const reportRequests = reportRequestsRaw.map(({ _count, ...row }) => ({ ...row, documents: row.documents.map(document => ({ ...document, byteSize: document.byteSize?.toString() ?? null })), documentsTotal: _count.documents, documentsTruncated: _count.documents > row.documents.length }));
      await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-sync-task-detail", permission.user.role);
      return NextResponse.json({ taskDetail: { ...task, attemptRuns: attemptRuns.map(attempt => ({ ...attempt, safeErrorSummary: attempt.safeErrorSummary?.slice(0, 300) ?? null })), attemptPagination: { page: query.attemptPage, pageSize: query.attemptPageSize, total: attemptTotal, pageCount: Math.ceil(attemptTotal / query.attemptPageSize), hasMore: query.attemptPage * query.attemptPageSize < attemptTotal }, reportRequests, reportRequestTotal, reportRequestsTruncated: reportRequestTotal > reportRequests.length, reportVersions, reportVersionTotal, reportVersionsTruncated: reportVersionTotal > reportVersions.length, freshness }, taskFilters: { taskId: query.taskId, profileId: query.profileId ?? null, status: query.status ?? null } }, { headers });
    }
    const planWhere = { ...scope, profile: { is: visibleProfile } };
    const plans = await prisma.amazonAdsSyncPlan.findMany({ where: planWhere, include: { profile: { select: { profileId: true, region: true, countryCode: true, marketplaceId: true, sellerAccountId: true, authorization: { select: { name: true, status: true } } } }, tasks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, stage: true, trigger: true, attempts: true, maxAttempts: true, processedCount: true, apiRequests: true, errorCode: true, requestedFrom: true, requestedTo: true, startedAt: true, finishedAt: true, createdAt: true, attemptRuns: { orderBy: { attemptNumber: "desc" }, take: 1, select: { attemptNumber: true, stage: true, status: true, startedAt: true, finishedAt: true, retryAt: true, errorCode: true, safeErrorSummary: true, apiRequests: true, processedCount: true } } } } }, orderBy: [{ updatedAt: "desc" }], take: 200 });
    const taskWhere = { ...scope, ...(query.status ? { status: query.status } : {}), profile: { is: visibleProfile } };
    const [taskTotal, taskHistory] = await Promise.all([
      prisma.amazonAdsSyncTask.count({ where: taskWhere }),
      prisma.amazonAdsSyncTask.findMany({ where: taskWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, planId: true, profileId: true, status: true, stage: true, trigger: true, attempts: true, maxAttempts: true, processedCount: true, apiRequests: true, errorCode: true, requestedFrom: true, requestedTo: true, startedAt: true, finishedAt: true, createdAt: true, profile: { select: { profileId: true, region: true, countryCode: true, marketplaceId: true, sellerAccountId: true } }, attemptRuns: { orderBy: { attemptNumber: "desc" }, take: 1, select: { attemptNumber: true, stage: true, status: true, startedAt: true, finishedAt: true, retryAt: true, errorCode: true, safeErrorSummary: true, apiRequests: true, processedCount: true } } } }),
    ]);
    const freshness = plans.length ? await prisma.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId: { in: plans.map(plan => plan.profileId) } }, orderBy: [{ profileId: "asc" }, { dataDomain: "asc" }, { reportType: "asc" }], select: { profileId: true, dataDomain: true, reportType: true, status: true, coveredFrom: true, coveredTo: true, lastAttemptAt: true, lastSuccessAt: true, lastTaskId: true, warningCodes: true } }) : [];
    await auditAmazonDataRead(scope, permission.user.id, "amazon-ads-sync-status", permission.user.role);
    return NextResponse.json({ plans, freshness, taskHistory, taskPagination: { page: query.page, pageSize: query.pageSize, total: taskTotal, pageCount: Math.ceil(taskTotal / query.pageSize), hasMore: query.page * query.pageSize < taskTotal }, taskFilters: { taskId: null, profileId: query.profileId ?? null, status: query.status ?? null }, dataDomain: "SP_STRUCTURE", reportSyncEnabled: false }, { headers });
  } catch (error) {
    if (error instanceof SyncInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof Error && /筛选|分页/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: "无法读取 Amazon Ads 同步状态。" }, { status: 500, headers });
  }
}
export async function POST(request: Request) {
  const permission = await requireApiPermission("settings", "edit", request);
  if (!permission.ok) return NextResponse.json({ error: "Forbidden." }, { status: permission.response.status, headers });
  try {
    const body = await boundedJsonObject(request, 2048);
    const action = body && typeof body.action === "string" ? body.action : "";
    if (!body || !["pause", "resume", "retry", "run", "cancel"].includes(action) || (action === "cancel" ? typeof body.taskId !== "string" || body.taskId.length > 100 : typeof body.planId !== "string" || body.planId.length > 100)) return NextResponse.json({ error: "同步任务操作参数无效。" }, { status: 400, headers });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    if (action === "cancel") return NextResponse.json(await cancelAdsTask(scope, permission.user.id, body.taskId as string), { headers });
    if (action === "run") return NextResponse.json(await runAdsPlanNow(scope, permission.user.id, body.planId as string), { headers, status: 202 });
    const result = await controlAdsPlan(scope, permission.user.id, body.planId as string, action as "pause" | "resume" | "retry");
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法更新 Ads 同步计划。" }, { status: 400, headers });
  }
}
