import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAdsSettingsManager, type AdsAuthScope } from "./authorization";
import { adsScopeEnabled } from "./sync-policy";
import { adsReadAdapterReady } from "./sync-adapter";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { AdsSyncError } from "./sync-policy";
import { adsTaskRoutingSelect, isAdsStructureTask } from "./task-routing";

export async function adsSyncLock(tx: Prisma.TransactionClient, profileId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ads-sync:${profileId}`}, 0))`;
}
/** Persist the intent only. Queue dispatch belongs to the worker, never the OAuth request. */
export async function ensureAdsPlan(tx: Prisma.TransactionClient, scope: AdsAuthScope, profileId: string, actor: string) {
  await adsSyncLock(tx, profileId);
  await assertAdsSettingsManager(scope, actor, tx);
  const profile = await tx.amazonAdsProfile.findFirst({ where: { ...scope, id: profileId }, include: { authorization: true } });
  if (!profile) throw new Error("Ads Profile 不存在。");
  const key = { organizationId_workspaceId_profileId: { ...scope, profileId } };
  const prior = await tx.amazonAdsSyncPlan.findUnique({ where: key });
  const bound = profile.sellerAccountId && await tx.sellerAccount.findFirst({ where: { ...scope, id: profile.sellerAccountId, status: "active" }, select: { id: true } });
  if (!bound || profile.authorization.status !== "CONNECTED") {
    if (prior) await tx.amazonAdsSyncPlan.update({ where: { id: prior.id }, data: { status: "BLOCKED", revision: { increment: 1 }, lastErrorCode: "ADS_BINDING_NOT_READY" } });
    return;
  }
  const data = { actorUserId: actor, sellerAccountId: bound.id, authorizationRevision: profile.authorization.revision };
  const readyStatus = !adsScopeEnabled(scope) ? "WAITING_FOR_CONFIG" : !adsReadAdapterReady() ? "WAITING_FOR_ADAPTER" : "ACTIVE";
  let currentPlan;
  if (!prior) {
    currentPlan = await tx.amazonAdsSyncPlan.create({ data: { ...scope, profileId, id: randomUUID(), ...data, status: readyStatus } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.sync.plan.created", entityType: "AmazonAdsSyncPlan", entityId: currentPlan.id, metadata: { workspaceId: scope.workspaceId, profileId, sellerAccountId: bound.id } } });
  } else if (prior.sellerAccountId !== bound.id || prior.authorizationRevision !== profile.authorization.revision || prior.status === "BLOCKED" || prior.status.startsWith("WAITING_FOR_")) {
    currentPlan = await tx.amazonAdsSyncPlan.update({ where: { id: prior.id }, data: { ...data, status: readyStatus, revision: { increment: 1 }, nextRunAt: new Date(), lastErrorCode: readyStatus === "ACTIVE" ? null : readyStatus } });
  } else currentPlan = prior;

  if (currentPlan.status !== "ACTIVE" || readyStatus !== "ACTIVE") return;
  const existingStructure = await tx.amazonAdsSyncTask.findFirst({
    where: { ...scope, planId: currentPlan.id, planRevision: currentPlan.revision, trigger: { in: ["schedule", "scheduled-structure", "manual-structure", "manual-retry"] }, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "SUCCEEDED"] }, requestedFrom: null, requestedTo: null, reportRequests: { none: {} }, reportVersions: { none: {} } },
    select: { id: true },
  });
  if (existingStructure) return;
  const idempotencyKey = `initial-structure:${currentPlan.id}:${currentPlan.revision}`;
  const priorInitial = await tx.amazonAdsSyncTask.findUnique({ where: { organizationId_workspaceId_idempotencyKey: { ...scope, idempotencyKey } }, select: { id: true } });
  if (priorInitial) return;
  await tx.amazonAdsSyncTask.create({ data: {
    ...scope, id: randomUUID(), planId: currentPlan.id, profileId: currentPlan.profileId,
    requestedByUserId: actor, idempotencyKey, planRevision: currentPlan.revision, trigger: "schedule",
  } });
}
export async function assertAdsLivePlan(tx: Prisma.TransactionClient, scope: AdsAuthScope, planId: string, revision: number) {
  if (!adsScopeEnabled(scope)) throw new AdsSyncError("ADS_SYNC_DISABLED");
  const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId, revision, status: "ACTIVE" }, include: { profile: { include: { authorization: true } } } });
  if (!plan || plan.sellerAccountId !== plan.profile.sellerAccountId || plan.authorizationRevision !== plan.profile.authorization.revision || plan.profile.authorization.status !== "CONNECTED" || (plan.profile.authorization.refreshTokenExpiresAt && plan.profile.authorization.refreshTokenExpiresAt <= new Date())) throw new AdsSyncError("ADS_PLAN_SCOPE_CHANGED");
  await assertAdsSettingsManager(scope, plan.actorUserId, tx);
  if (!await tx.sellerAccount.findFirst({ where: { ...scope, id: plan.sellerAccountId, status: "active" }, select: { id: true } })) throw new AdsSyncError("ADS_SELLER_UNAVAILABLE");
  return plan;
}
export async function controlAdsPlan(scope: AdsAuthScope, actor: string, planId: string, action: "pause" | "resume" | "retry") {
  return prisma.$transaction(async tx => {
    await assertAdsSettingsManager(scope, actor, tx);
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId } });
    if (!plan) throw new Error("Ads 同步计划不存在。");
    await adsSyncLock(tx, plan.profileId);
    if (action === "retry") {
      if (!adsScopeEnabled(scope) || !adsReadAdapterReady()) throw new Error("Ads 同步配置或读取 adapter 尚未就绪，当前不能重试。");
      const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, planId, status: { in: ["FAILED", "BLOCKED"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { _count: adsTaskRoutingSelect._count } });
      if (!task) throw new Error("没有可重试的失败任务。");
      if (!isAdsStructureTask(task)) throw new Error("此任务不属于结构同步，不能通过结构计划重试；报告阶段和预算保持不变。");
      await tx.amazonAdsSyncPlan.update({ where: { id: plan.id }, data: { status: "ACTIVE", actorUserId: actor, nextRunAt: new Date(), lastErrorCode: null } });
      await tx.amazonAdsSyncTask.update({ where: { id: task.id }, data: { status: "WAITING", trigger: "manual-retry", planRevision: plan.revision, attempts: 0, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, nextAttemptAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null, leaseOwner: null, leaseExpiresAt: null } });
    } else {
      const status = action === "pause" ? "PAUSED" : !adsScopeEnabled(scope) ? "WAITING_FOR_CONFIG" : !adsReadAdapterReady() ? "WAITING_FOR_ADAPTER" : "ACTIVE";
      await tx.amazonAdsSyncPlan.update({ where: { id: plan.id }, data: { status, revision: { increment: 1 }, actorUserId: actor, nextRunAt: new Date(), lastErrorCode: null } });
      if (action === "pause") {
        const activeTasks = await tx.amazonAdsSyncTask.findMany({ where: { ...scope, planId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } }, select: { id: true, ...adsTaskRoutingSelect, attemptRuns: { orderBy: { attemptNumber: "desc" }, take: 1, select: { id: true, status: true } } } });
        const now = new Date();
        await tx.amazonAdsSyncTask.updateMany({ where: { ...scope, planId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } }, data: { status: "CANCELLED", fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, finishedAt: now, leaseOwner: null, leaseExpiresAt: null, errorCode: "ADS_TASK_CANCELLED", errorMessage: "同步计划已暂停，未完成任务已取消。" } });
        if (activeTasks.length) {
          for (const task of activeTasks) {
            const attempt = task.attemptRuns[0];
            if (attempt && ["RUNNING", "RETRY_WAIT"].includes(attempt.status)) await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, id: attempt.id, status: attempt.status }, data: { status: "CANCELLED", finishedAt: now, retryAt: null, errorCode: "ADS_TASK_CANCELLED", safeErrorSummary: "同步计划已暂停；已提交的页面保持不变。" } });
          }
          const structureTask = activeTasks.find(isAdsStructureTask);
          if (structureTask) {
            const domain = await tx.amazonAdsSyncDomainState.findUnique({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: plan.profileId, dataDomain: "entities", reportType: "" } }, select: { lastSuccessAt: true, warningCodes: true } });
            await tx.amazonAdsSyncDomainState.upsert({
              where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: plan.profileId, dataDomain: "entities", reportType: "" } },
              create: { id: randomUUID(), ...scope, profileId: plan.profileId, dataDomain: "entities", reportType: "", status: "CANCELLED", lastAttemptAt: now, lastSuccessAt: null, lastTaskId: structureTask.id, warningCodes: ["ADS_TASK_CANCELLED"] },
              update: { status: domain?.lastSuccessAt ? "STALE" : "CANCELLED", lastAttemptAt: now, lastTaskId: structureTask.id, warningCodes: [...new Set([...(domain?.warningCodes ?? []), "ADS_TASK_CANCELLED"])] },
            });
          }
        }
      }
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.ads.sync.plan.${action}`, entityType: "AmazonAdsSyncPlan", entityId: planId, metadata: { workspaceId: scope.workspaceId } } });
    return { ok: true };
  });
}

/** Cancel one persisted task without deleting its checkpoint or source facts. */
export async function cancelAdsTask(scope: AdsAuthScope, actor: string, taskId: string) {
  return prisma.$transaction(async tx => {
    await assertAdsSettingsManager(scope, actor, tx);
    const initial = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: taskId }, select: { id: true, profileId: true, planId: true, status: true, dispatchVersion: true } });
    if (!initial) throw new Error("Ads 同步任务不存在。");
    await adsSyncLock(tx, initial.profileId);
    const task = await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, id: taskId }, select: { id: true, profileId: true, planId: true, status: true, dispatchVersion: true, ...adsTaskRoutingSelect, attemptRuns: { orderBy: { attemptNumber: "desc" }, take: 1, select: { id: true, status: true } } } });
    if (!task) throw new Error("Ads 同步任务不存在。");
    if (!["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"].includes(task.status)) return { ok: true, taskId, status: task.status, alreadyFinished: true };
    const now = new Date();
    const changed = await tx.amazonAdsSyncTask.updateMany({
      where: { ...scope, id: taskId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] }, dispatchVersion: task.dispatchVersion },
      data: { status: "CANCELLED", dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, finishedAt: now, nextAttemptAt: now, errorCode: "ADS_TASK_CANCELLED", errorMessage: "任务已由有权限的操作者取消。" },
    });
    if (!changed.count) {
      const current = await tx.amazonAdsSyncTask.findUnique({ where: { id: taskId }, select: { status: true } });
      return { ok: true, taskId, status: current?.status ?? "CANCELLED", alreadyFinished: true };
    }
    const latestAttempt = task.attemptRuns[0];
    if (latestAttempt && ["RUNNING", "RETRY_WAIT"].includes(latestAttempt.status)) await tx.amazonAdsSyncAttempt.updateMany({ where: { ...scope, id: latestAttempt.id, status: latestAttempt.status }, data: { status: "CANCELLED", finishedAt: now, retryAt: null, errorCode: "ADS_TASK_CANCELLED", safeErrorSummary: "任务已取消；已提交的页面保持不变。" } });
    if (isAdsStructureTask(task)) {
      const currentDomain = await tx.amazonAdsSyncDomainState.findUnique({ where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: task.profileId, dataDomain: "entities", reportType: "" } }, select: { lastSuccessAt: true, warningCodes: true } });
      const warningCodes = [...new Set([...(currentDomain?.warningCodes ?? []), "ADS_TASK_CANCELLED"])];
      await tx.amazonAdsSyncDomainState.upsert({
        where: { organizationId_workspaceId_profileId_dataDomain_reportType: { ...scope, profileId: task.profileId, dataDomain: "entities", reportType: "" } },
        create: { id: randomUUID(), ...scope, profileId: task.profileId, dataDomain: "entities", reportType: "", status: "CANCELLED", lastAttemptAt: now, lastSuccessAt: null, lastTaskId: taskId, warningCodes },
        update: { status: currentDomain?.lastSuccessAt ? "STALE" : "CANCELLED", lastAttemptAt: now, lastTaskId: taskId, warningCodes },
      });
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.sync.task.cancelled", entityType: "AmazonAdsSyncTask", entityId: taskId, metadata: { workspaceId: scope.workspaceId, profileId: task.profileId, planId: task.planId, previousStatus: task.status } } });
    return { ok: true, taskId, status: "CANCELLED", alreadyFinished: false };
  });
}

export async function runAdsPlanNow(scope: AdsAuthScope, actor: string, planId: string) {
  if (!adsScopeEnabled(scope) || !adsReadAdapterReady()) throw new Error("Ads 自动同步尚未启用：需要工作区 allowlist 和已验证的读取 adapter。");
  if (process.env.QUEUE_DRIVER !== "redis") throw new Error("Ads 同步队列未配置。");
  const task = await prisma.$transaction(async tx => {
    const plan = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId, status: "ACTIVE" }, include: { profile: true } });
    if (!plan) throw new Error("活动 Ads 同步计划不存在。");
    await adsSyncLock(tx, plan.profileId);
    await assertAdsSettingsManager(scope, actor, tx);
    const ready = await tx.amazonAdsSyncPlan.findFirst({ where: { ...scope, id: planId, revision: plan.revision, status: "ACTIVE", profile: { sellerAccountId: plan.sellerAccountId, authorization: { status: "CONNECTED" } } }, include: { profile: true } });
    if (!ready) throw new Error("Ads Profile、店铺绑定或授权状态已变化。");
    if (await tx.amazonAdsSyncTask.findFirst({ where: { ...scope, planId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] } } })) throw new Error("该 Profile 已有进行中的 Ads 同步任务。");
    const taskId = randomUUID();
    const idempotencyKey = `manual:${plan.id}:${plan.revision}:${taskId}`;
    const created = await tx.amazonAdsSyncTask.create({ data: { ...scope, id: taskId, planId: plan.id, profileId: plan.profileId, requestedByUserId: actor, idempotencyKey, planRevision: plan.revision, trigger: "manual-structure" } });
    await tx.amazonAdsSyncPlan.update({ where: { id: plan.id }, data: { nextRunAt: new Date(Date.now() + plan.intervalMinutes * 60_000) } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.ads.sync.task.requested", entityType: "AmazonAdsSyncTask", entityId: created.id, metadata: { workspaceId: scope.workspaceId, profileId: plan.profileId, trigger: "manual" } } });
    return created;
  });
  try {
    await getAmazonSyncQueue().add("process-amazon-ads-sync-task", { runId: task.id, adsTaskId: task.id, adsDispatchVersion: task.dispatchVersion }, { jobId: `ads-${task.id}-${task.dispatchVersion}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
    await prisma.amazonAdsSyncTask.updateMany({ where: { ...scope, id: task.id, status: "WAITING", dispatchVersion: task.dispatchVersion }, data: { status: "QUEUED" } });
  } catch {
    return { taskId: task.id, status: "WAITING", message: "任务已保存，worker 恢复器会再次投递。" };
  }
  return { taskId: task.id, status: "QUEUED" };
}
