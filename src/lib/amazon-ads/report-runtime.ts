import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";
import { amazonDataAccess, sellerAccessWhere } from "@/lib/amazon-sync/data-access";
import { AdsQueryError } from "./query-contract";
import { assertIsolatedReportEnvironment, processIsolatedCampaignReport, type AcquisitionState, type IsolatedReportTransport } from "./report-acquisition";

/** Explicit queue integration for initialized fixture tasks. No live transport or startup hook. */
export type ReportDispatch = { taskId: string; dispatchVersion: number };
export type ReportEnqueue = (job: ReportDispatch) => Promise<unknown>;
const trigger = "isolated-report";
const terminal = ["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED"];
async function lock(tx: Prisma.TransactionClient, taskId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report:${taskId}`}, 0))`;
}
async function authorize(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, profileId: string) {
  const access = await amazonDataAccess(scope, actor, tx, "sync");
  const sellers = await tx.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
  if (!await tx.amazonAdsProfile.findFirst({ where: { ...scope, ...sellerAccessWhere(access), id: profileId, sellerAccountId: { in: sellers.map(s => s.id) }, authorization: { status: "CONNECTED" } } })) throw new AdsQueryError("ADS_REPORT_PROFILE_FORBIDDEN", 403);
}
function state(options: Prisma.JsonValue): AcquisitionState | undefined {
  return (options as unknown as { acquisition?: AcquisitionState })?.acquisition;
}

/** DB is authoritative. Failed enqueue leaves a due task for the next tick. */
export async function tickIsolatedReports(scope: SyncScope, enqueue: ReportEnqueue) {
  assertIsolatedReportEnvironment();
  const now = new Date();
  const rows = await prisma.amazonAdsSyncTask.findMany({ where: { ...scope, trigger, OR: [{ status: { in: ["WAITING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } }, { status: "RUNNING", leaseExpiresAt: { lte: now } }, { status: "SUCCEEDED", attemptRuns: { some: { status: "RUNNING" } } }] }, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: 100 });
  let enqueued = 0, enqueueFailures = 0;
  for (const row of rows) {
    const job = await prisma.$transaction(async tx => {
      await lock(tx, row.id);
      const current = await tx.amazonAdsSyncTask.findUniqueOrThrow({ where: { id: row.id } });
      if (current.status === "SUCCEEDED") {
        // Publication committed before a process crash; never publish a new version.
        await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: row.id, status: "RUNNING" }, data: { status: "SUCCEEDED", finishedAt: current.finishedAt ?? new Date() } });
        return;
      }
      if (current.status === "RUNNING") {
        if (!current.leaseExpiresAt || current.leaseExpiresAt > new Date()) return;
        await tx.amazonAdsSyncTask.update({ where: { id: row.id }, data: { status: "RETRY_WAIT", dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
        await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: row.id, status: "RUNNING" }, data: { status: "RETRY_WAIT", finishedAt: new Date(), errorCode: "ADS_REPORT_LEASE_EXPIRED" } });
        return { taskId: row.id, dispatchVersion: current.dispatchVersion + 1 };
      }
      if (!["WAITING", "RETRY_WAIT"].includes(current.status) || current.nextAttemptAt > new Date()) return;
      return { taskId: row.id, dispatchVersion: current.dispatchVersion };
    });
    if (job) {
      try { await enqueue(job); enqueued++; }
      catch { enqueueFailures++; } // Persisted due state is retried by the next tick.
    }
  }
  return { enqueued, enqueueFailures };
}

/** One bounded step per message. A waiting remote report holds no worker lease. */
export async function runIsolatedReportDispatch(scope: SyncScope, job: ReportDispatch, transport: IsolatedReportTransport) {
  assertIsolatedReportEnvironment(transport);
  const claimed = await prisma.$transaction(async tx => {
    await lock(tx, job.taskId);
    const row = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: job.taskId, trigger, dispatchVersion: job.dispatchVersion, status: { in: ["WAITING", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date() }, plan: { status: "ACTIVE" } } });
    if (!row) return;
    try { await authorize(tx, scope, row.requestedByUserId, row.profileId); }
    catch (error) {
      if (!(error instanceof AdsQueryError || error instanceof SyncInputError)) throw error;
      await tx.amazonAdsSyncTask.update({ where: { id: row.id }, data: { status: "BLOCKED", errorCode: "ADS_REPORT_PROFILE_FORBIDDEN", finishedAt: new Date(), fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
      return;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-report-profile:${row.profileId}`}, 0))`;
    if (await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, trigger, profileId: row.profileId, id: { not: row.id }, status: "RUNNING", leaseExpiresAt: { gt: new Date() } } })) return;
    const fence = { taskId: row.id, dispatchVersion: row.dispatchVersion, fenceVersion: row.fenceVersion + 1, leaseOwner: randomUUID() };
    await tx.amazonAdsSyncTask.update({ where: { id: row.id }, data: { status: "RUNNING", fenceVersion: fence.fenceVersion, leaseOwner: fence.leaseOwner, leaseExpiresAt: new Date(Date.now() + 60000), startedAt: row.startedAt ?? new Date() } });
    await tx.amazonAdsSyncAttempt.create({ data: { ...scope, id: randomUUID(), profileId: row.profileId, taskId: row.id, attemptNumber: row.dispatchVersion, stage: row.stage, status: "RUNNING" } });
    return { row, fence };
  });
  if (!claimed) return;
  let errorCode: string | null = null;
  try { await processIsolatedCampaignReport(scope, claimed.row.requestedByUserId, claimed.fence, transport); }
  catch (error) { errorCode = error instanceof AdsQueryError && /^ADS_[A-Z_]+$/.test(error.message) ? error.message : "ADS_REPORT_RUNTIME_FAILED"; }
  await prisma.$transaction(async tx => {
    await lock(tx, job.taskId);
    const row = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: job.taskId, dispatchVersion: job.dispatchVersion, fenceVersion: claimed.fence.fenceVersion } });
    if (!row || !["RUNNING", "SUCCEEDED"].includes(row.status)) return;
    const request = await tx.amazonAdsReportRequest.findFirst({ where: { ...scope, sourceTaskId: row.id } });
    const acquisition = request && state(request.requestOptions);
    const readRetry = !!acquisition && ["POLL", "DOWNLOAD"].includes(acquisition.phase) && ["ADS_REPORT_OPERATION_TIMEOUT", "ADS_REPORT_ACQUISITION_FAILED"].includes(errorCode ?? "") && acquisition.calls[acquisition.phase === "POLL" ? "poll" : "download"] < (acquisition.phase === "POLL" ? 10 : 3);
    const blocked = !acquisition || (errorCode && !readRetry) || (acquisition && (!Number.isFinite(Date.parse(acquisition.deadline)) || Date.parse(acquisition.deadline) <= Date.now()));
    const status = row.status === "SUCCEEDED" ? "SUCCEEDED" : blocked ? "BLOCKED" : readRetry ? "RETRY_WAIT" : "WAITING";
    const due = acquisition?.nextPollAt ? Date.parse(acquisition.nextPollAt) : 0;
    const retryAt = new Date(Math.max(Date.now() + (readRetry ? 1000 : 0), Number.isFinite(due) ? due : 0));
    await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId: row.id, attemptNumber: job.dispatchVersion, status: "RUNNING" }, data: { status: errorCode ? status : "SUCCEEDED", finishedAt: new Date(), retryAt: ["WAITING", "RETRY_WAIT"].includes(status) ? retryAt : null, errorCode, apiRequests: row.apiRequests - claimed.row.apiRequests } });
    if (row.status !== "SUCCEEDED") await tx.amazonAdsSyncTask.update({ where: { id: row.id }, data: { status, stage: `REPORT_${acquisition?.phase ?? "UNKNOWN"}`, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: retryAt, errorCode: blocked ? errorCode ?? "ADS_REPORT_RUNTIME_BLOCKED" : errorCode, finishedAt: blocked ? new Date() : null } });
  });
}

/** Resume preserves acquisition phase, deadline, counters and frozen scope. */
export async function controlIsolatedReport(scope: SyncScope, actor: string, taskId: string, action: "pause" | "resume" | "cancel") {
  assertIsolatedReportEnvironment();
  if (!["pause", "resume", "cancel"].includes(action)) throw new AdsQueryError("ADS_REPORT_CONTROL_INVALID");
  return prisma.$transaction(async tx => {
    await lock(tx, taskId);
    const row = await tx.amazonAdsSyncTask.findFirstOrThrow({ where: { ...scope, id: taskId, trigger, requestedByUserId: actor } });
    await authorize(tx, scope, actor, row.profileId);
    if (terminal.includes(row.status)) throw new AdsQueryError("ADS_REPORT_TASK_TERMINAL", 409);
    if (action === "resume" && row.status !== "PAUSED") throw new AdsQueryError("ADS_REPORT_TASK_NOT_PAUSED", 409);
    const status = action === "pause" ? "PAUSED" : action === "cancel" ? "CANCELLED" : "WAITING";
    await tx.amazonAdsSyncTask.update({ where: { id: row.id }, data: { status, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, finishedAt: action === "cancel" ? new Date() : null } });
    await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, taskId, status: "RUNNING" }, data: { status, finishedAt: new Date() } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.ads.report.${action}`, entityType: "AmazonAdsSyncTask", entityId: taskId, metadata: { workspaceId: scope.workspaceId, evidence: "ISOLATED_FIXTURE_ONLY" } } });
    return { status };
  });
}
