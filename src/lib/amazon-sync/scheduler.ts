import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { configuredSyncScopes } from "./activation";
import { continuityGrant } from "./continuity-access";
import { maintainContinuity } from "./continuity";
import { automaticAdapters, automaticAdapter, automaticAdapterHasRequiredPolicy, automaticSourcePolicyFields, assertAutomaticAdapterPolicy } from "./automatic-adapters";
import { digest } from "./approval-policy";
import { ensureAutomaticConnections } from "./automatic-connection";
import { assertExecutionWindow } from "./execution-window";
import { dispatchSalesExports } from "./exports";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createTask, scopeLock, syncIncrementalCursorStatus } from "./service";
import { activeTaskStatuses, isIncrementalResource, SyncInputError, type SyncScope } from "./policy";
import { parseOrderSyncPolicy } from "./orders";
import { automaticBackfillStart, automaticResourceIntervalMinutes, automaticMarketplaces, automaticMarketplaceAllowed, automaticPlanId, automaticPlanKey, automaticResources, isAutomaticResource, automaticTaskKey } from "./automatic-schedule";
import { planAutomaticTask } from "./automatic-planner";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import { recoverFinanceParserFailures } from "./finance-parser-recovery";
import { recoverAutomaticFailures, automaticTransientFailureCodes } from "./automatic-recovery";
import { recoverRenewedAuthorizations } from "./authorization-recovery";

export function enabledSyncScopes(value = process.env.AMAZON_SYNC_CENTER_SCOPES): SyncScope[] {
  return configuredSyncScopes(value) ?? [];
}

export async function resolveEnabledSyncScopes(): Promise<SyncScope[]> {
  const configured = configuredSyncScopes(process.env.AMAZON_SYNC_CENTER_SCOPES);
  if (configured !== null) return configured;
  const scopes = await prisma.amazonSpApiAuthorization.groupBy({ by: ["organizationId", "workspaceId"], where: { status: "CONFIGURED", lastValidatedAt: { not: null } } });
  return scopes.map(({ organizationId, workspaceId }) => ({ organizationId, workspaceId }));
}

/** Persist the first automatic work for one validated authorization before relying on Redis. */
export async function ensureAmazonSyncInitialized(scope: SyncScope, authorizationId: string, now = new Date()) {
  const configured = configuredSyncScopes(process.env.AMAZON_SYNC_CENTER_SCOPES);
  const enabled = configured === null || configured.some(candidate => candidate.organizationId === scope.organizationId && candidate.workspaceId === scope.workspaceId);
  if (!enabled) return { status: "scope_disabled" as const, sourceCount: 0, planCount: 0, taskCount: 0 };
  if (!process.env.DATABASE_URL) return { status: "database_unavailable" as const, sourceCount: 0, planCount: 0, taskCount: 0 };

  const beforeSources = await prisma.amazonSyncDataSource.count({ where: { ...scope, authorizationId } });
  const beforePlans = await prisma.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2, planKey: { startsWith: "auto-v1:" }, targets: { some: { source: { authorizationId } } } } });
  await ensureAutomaticConnections([scope], now, authorizationId);
  const sourceIds = (await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId }, select: { id: true } })).map(source => source.id);
  if (!sourceIds.length) return { status: "no_eligible_sources" as const, sourceCount: 0, planCount: 0, taskCount: 0 };
  await ensureAutomaticSchedules([scope], now, sourceIds);
  await recoverRenewedAuthorizations([scope], now, { authorizationId, forceInspection: true });
  await enqueueDueAutomaticPlans([scope], now, sourceIds);

  const [sourceCount, planCount, taskCount] = await Promise.all([
    prisma.amazonSyncDataSource.count({ where: { ...scope, authorizationId } }),
    prisma.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2, planKey: { startsWith: "auto-v1:" }, targets: { some: { sourceId: { in: sourceIds } } } } }),
    prisma.amazonSyncRun.count({ where: { ...scope, executionVersion: 2, sourceId: { in: sourceIds }, trigger: "schedule" } }),
  ]);
  return {
    status: sourceCount > 0 && planCount > 0 && taskCount > 0 ? "initialized" as const : "deferred" as const,
    sourceCount: Math.max(0, sourceCount - beforeSources),
    planCount: Math.max(0, planCount - beforePlans),
    taskCount,
  };
}

export async function tickSyncCenter(now = new Date(), only?: { taskIds: string[]; exportIds: string[] }) {
  if (!process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return;
  const scopes = await resolveEnabledSyncScopes();
  if (!scopes.length) return;
  // Durable recovery must run even when discovery, maintenance or exports fail.
  const recovery = { scopeCount: scopes.length, examined: 0, dispatched: 0, dispatchFailures: 0, expiredLeases: 0, automaticRecoveries: 0, authorizationRecoveries: 0, maintenanceFailures: 0 };
  if (!amazonCloudExecutionEnabled()) {
    // Local exports read the local replica. Official sync jobs and leases stay
    // untouched for the cloud scheduler; never consume them as local failures.
    await dispatchSalesExports(scopes, only?.exportIds);
    return { ...recovery, executionRole: "local" as const };
  }
  // A missing lease gets a full normal lease interval of grace. It must not
  // strand an interrupted task forever or fence a just-written transition.
  const expiredLeaseWhere: Prisma.AmazonSyncRunWhereInput = { OR: [
    { leaseExpiresAt: { lte: now } },
    { leaseExpiresAt: null, updatedAt: { lte: new Date(now.getTime() - 5 * 60_000) } },
  ] };
  const expired = await prisma.amazonSyncRun.findMany({ where: { AND: [{ OR: scopes }, expiredLeaseWhere], ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: "RUNNING" }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 100 });
  recovery.expiredLeases = expired.length;
  for (const run of expired) {
    try { await prisma.$transaction(async tx => {
      await scopeLock(tx, run);
      const status = run.control === "CANCEL" ? "CANCELLED" : run.control === "PAUSE" ? "PAUSED" : run.attempts >= run.maxAttempts ? "FAILED" : "RETRY_WAIT";
      const terminal = status === "FAILED" || status === "CANCELLED";
      const changed = await tx.amazonSyncRun.updateMany({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId, id: run.id, executionVersion: 2, status: "RUNNING", fenceVersion: run.fenceVersion, control: run.control, AND: [expiredLeaseWhere] }, data: { status, control: null, stage: run.stage, fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: terminal ? now : null, error: run.control ? null : "任务租约过期或缺失；从已提交分页检查点恢复，旧执行器不能发布。" } });
      if (changed.count) await syncIncrementalCursorStatus(tx, run, status);
      if (changed.count && status === "FAILED" && run.trigger === "schedule") {
        const summary = run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) ? run.summary as Prisma.JsonObject : {};
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { summary: { ...summary, quality: { code: "WORKER_INTERRUPTED", status: "FAILED", retryScheduled: false, published: false } } } });
      }
      if (changed.count) await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "LEASE_EXPIRED", stage: run.stage, code: run.control === "CANCEL" ? "CANCEL_REQUESTED" : run.control === "PAUSE" ? "PAUSE_REQUESTED" : run.leaseExpiresAt ? "INTERRUPTED" : "LEASE_MISSING" } });
    }); } catch { recovery.maintenanceFailures++; console.error(`[amazon-sync-center] lease recovery deferred for task ${run.id}; other tasks remain independent`); }
  }
  try { await recoverFinanceParserFailures(scopes, now, only ? { taskIds: only.taskIds } : undefined); } catch { recovery.maintenanceFailures++; }
  try { recovery.authorizationRecoveries = (await recoverRenewedAuthorizations(scopes, now, { taskIds: only?.taskIds })).recovered; } catch { recovery.maintenanceFailures++; }
  try { recovery.automaticRecoveries = (await recoverAutomaticFailures(scopes, now, only?.taskIds)).recovered; } catch { recovery.maintenanceFailures++; }
  const pending = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date(Math.max(now.getTime(), Date.now())) } }, orderBy: [{ priority: "asc" }, { nextAttemptAt: "asc" }], take: 100 });
  recovery.examined = pending.length;
  for (const run of pending) {
    try {
      try { if (run.trigger !== "schedule") assertExecutionWindow(run.frozenScope, now); } catch {
        if (isIncrementalResource(run.resource)) await blockIncrementalRun(run, now, "执行授权已过期或缺少截止时间，须重新审批。", "EXECUTION_EXPIRED");
        else await prisma.amazonSyncRun.updateMany({ where: { id: run.id, dispatchVersion: run.dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: "执行授权已过期或缺少截止时间，须重新审批。", finishedAt: now, dispatchVersion: { increment: 1 } } });
        continue;
      }
      const scheduledGrant = run.trigger === "schedule" && run.scheduleId && run.scheduleRevision !== null ? await prisma.amazonSyncSchedule.findFirst({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId, id: run.scheduleId, resource: run.resource, executionVersion: 2, enabled: true, revision: run.scheduleRevision, updatedByUserId: run.requestedByUserId, targets: { some: { sourceId: run.sourceId ?? "" } } }, select: { id: true } }) : null;
      const grant = run.trigger === "schedule" ? scheduledGrant : await prisma.amazonDataCenterChangeRequest.findFirst({ where: { id: run.executionApprovalId ?? "", organizationId: run.organizationId, workspaceId: run.workspaceId, status: "APPLIED", changeType: "SyncExecutionRequest", OR: [{ operation: "run" }, { operation: "control-task", targetId: run.id }], sourceIds: { has: run.sourceId ?? "" } }, select: { id: true } });
      if (!grant) {
        if (isIncrementalResource(run.resource)) await blockIncrementalRun(run, now, "执行审批缺失、过期或已撤销。", "APPROVAL_UNAVAILABLE");
        else await prisma.amazonSyncRun.updateMany({ where: { id: run.id, dispatchVersion: run.dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: "执行审批缺失、过期或已撤销。", finishedAt: now, dispatchVersion: { increment: 1 } } });
        continue;
      }
      // DB intent survives Redis loss; generation fences cancelled/old queue jobs.
      await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: run.id, dispatchVersion: run.dispatchVersion }, { jobId: `adc-${run.id}-${run.dispatchVersion}`, priority: run.priority, attempts: 1, removeOnComplete: true, removeOnFail: true });
      await prisma.amazonSyncRun.updateMany({ where: { id: run.id, status: "WAITING", dispatchVersion: run.dispatchVersion }, data: { status: "QUEUED" } });
      recovery.dispatched++;
    } catch { recovery.dispatchFailures++; console.error(`[amazon-sync-center] task ${run.id} dispatch deferred; intent retained`); }
  }
  const phases = [() => dispatchSalesExports(scopes, only?.exportIds), ...(!only ? [() => maintainContinuity(scopes, now), () => ensureAutomaticConnections(scopes, now), () => ensureAutomaticSchedules(scopes, now), () => enqueueDueAutomaticPlans(scopes, now)] : [])];
  for (const phase of phases) {
    try { await phase(); } catch { recovery.maintenanceFailures++; console.error("[amazon-sync-center] maintenance deferred; persisted recovery remains independent"); }
  }
  return recovery;
}

async function ensureAutomaticSchedules(scopes: SyncScope[], now: Date, sourceIds?: string[]) {
  // Apply registry prerequisites before the bounded scan. Incomplete sources
  // and tasks already executing must not starve later ready adapters/accounts.
  const policies: Prisma.AmazonSyncDataSourceWhereInput[] = automaticAdapters.map(definition => {
    const adapter = automaticAdapter(definition.resource)!;
    return { resource: adapter.resource, ...(adapter.requiredPolicy ? { [adapter.requiredPolicy]: { not: Prisma.AnyNull } } : {}) };
  });
  const sources = await prisma.amazonSyncDataSource.findMany({
    where: { AND: [{ OR: scopes }, { OR: policies }], ...(sourceIds ? { id: { in: sourceIds } } : {}), enabled: true, resource: { in: [...automaticResources] }, marketplaceId: { in: [...automaticMarketplaces] }, authorization: { status: "CONFIGURED" },
      runs: { none: { status: { in: activeTaskStatuses } } },
      targets: { none: { schedule: { executionVersion: 2, planKey: { startsWith: "auto-v1:" } } } } },
    include: { authorization: { select: { updatedByUserId: true } }, resourceCursor: true }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 200,
  });
  for (const candidate of sources) {
    const candidateAdapter = automaticAdapter(candidate.resource);
    if (!candidateAdapter || !automaticAdapterHasRequiredPolicy(candidateAdapter, candidate)) continue;
    const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
    try { await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: candidate.id, authorization: { status: "CONFIGURED" } }, include: { authorization: { select: { updatedByUserId: true } } } });
      if (!source || !source.enabled || source.resource !== candidate.resource || !automaticAdapterHasRequiredPolicy(candidateAdapter, source)) return;
      try { assertAutomaticAdapterPolicy(candidateAdapter, source); }
      catch {
        const id = digest([scope, source.id, source.revision, "automatic-policy-invalid"]);
        if (!await tx.auditLog.findUnique({ where: { id }, select: { id: true } })) await tx.auditLog.create({ data: {
          id, organizationId: scope.organizationId, userId: source.authorization.updatedByUserId,
          action: "amazon.sync.plan.policy-invalid", entityType: "AmazonSyncDataSource", entityId: source.id,
          metadata: { workspaceId: scope.workspaceId, resource: source.resource, sourceRevision: source.revision,
            policyField: candidateAdapter.requiredPolicy ?? null, code: "AUTOMATIC_POLICY_INVALID", taskCreated: false },
        } });
        return;
      }
      if (candidateAdapter.scheduleReady && !candidateAdapter.scheduleReady(source)) return;
      const key = automaticPlanKey(source.id);
      const exists = await tx.amazonSyncSchedule.findUnique({ where: { organizationId_workspaceId_resource_planKey: { ...scope, resource: source.resource, planKey: key } }, select: { id: true } });
      if (exists) return;
      await assertAmazonScopeAdmin(scope, source.authorization.updatedByUserId, tx);
      await assertAmazonAction(scope, source.authorization.updatedByUserId, "create", tx);
      await assertAmazonAction(scope, source.authorization.updatedByUserId, "approve", tx);
      if (await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, status: { in: activeTaskStatuses } }, select: { id: true } })) return;
      const adapter = automaticAdapter(source.resource);
      if (!adapter) return;
      const defaultInitialFrom = automaticBackfillStart(now);
      const backfillStart = adapter.scheduleInitialFrom?.(source, defaultInitialFrom) ?? defaultInitialFrom;
      const schedulePolicies = adapter.prepareSchedulePolicy?.(source, defaultInitialFrom);
      if (schedulePolicies) assertAutomaticAdapterPolicy(adapter, { ...source, ...schedulePolicies });
      if (schedulePolicies && Object.keys(schedulePolicies).length) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: {
        ...Object.fromEntries(Object.entries(automaticSourcePolicyFields(schedulePolicies)).map(([key, value]) => [key, value as Prisma.InputJsonValue])), revision: { increment: 1 },
      } });
      const id = automaticPlanId(source.id);
      const plan = await tx.amazonSyncSchedule.create({ data: { ...scope, id, resource: source.resource, executionVersion: 2, planKey: key, name: `自动同步 · ${source.resource}`, revision: 1, mode: adapter.scheduleMode, priority: 1, maxAttempts: 3, retentionDays: 30, nextRunAt: now, intervalMinutes: automaticResourceIntervalMinutes(source.resource), enabled: true, updatedByUserId: source.authorization.updatedByUserId } });
      await tx.amazonSyncPlanTarget.create({ data: { ...scope, scheduleId: plan.id, sourceId: source.id } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: source.authorization.updatedByUserId, action: "amazon.sync.plan.automatic_created", entityType: "AmazonSyncSchedule", entityId: plan.id, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, resource: source.resource, marketplaceId: source.marketplaceId, ...(source.resource === "orders" || source.resource === "finance" || source.resource === "returns" ? { initialFrom: backfillStart } : {}), ...(source.resource === "inventory_events" ? { initialFrom: new Date(now.getTime() - 540 * 86_400_000).toISOString() } : {}) } } });
    }); } catch { console.error(`[amazon-sync-center] automatic plan discovery deferred for source ${candidate.id}`); }
    // Persist scan rotation using existing modification metadata. Never change
    // configuration/revision, coverage, grants, cursor or task state. A concurrent
    // edit, new plan or active task makes this guarded inspection touch a no-op.
    try {
      await prisma.amazonSyncDataSource.updateMany({ where: { ...scope, id: candidate.id, revision: candidate.revision,
        updatedAt: candidate.updatedAt, enabled: true, runs: { none: { status: { in: activeTaskStatuses } } },
        targets: { none: { schedule: { executionVersion: 2, planKey: { startsWith: "auto-v1:" } } } } },
        data: { updatedAt: new Date(Math.max(now.getTime(), candidate.updatedAt.getTime() + 1)) } });
    } catch { /* A DB outage leaves the original source eligible for a later scan. */ }
  }
}

export async function enqueueDueAutomaticPlans(scopes: SyncScope[], now: Date, sourceIds?: string[]) {
  const plans = await prisma.amazonSyncSchedule.findMany({ where: { OR: scopes, executionVersion: 2, enabled: true, planKey: { startsWith: "auto-v1:" }, ...(sourceIds ? { targets: { some: { sourceId: { in: sourceIds } } } } : {}), nextRunAt: { lte: now } }, include: { targets: { include: { source: { include: { authorization: true, seller: true, resourceCursor: true } } } } }, orderBy: [{ nextRunAt: "asc" }, { id: "asc" }], take: 100 });
  for (const plan of plans) {
    try {
    if (!isAutomaticResource(plan.resource)) continue;
    const target = plan.targets[0]?.source;
    if (!target || !target.enabled || plan.targets.length !== 1 || target.authorization.status !== "CONFIGURED" || !automaticMarketplaceAllowed(plan.resource, target.marketplaceId)) continue;
    if (await prisma.amazonSyncRun.findFirst({ where: { organizationId: plan.organizationId, workspaceId: plan.workspaceId, sourceId: target.id, status: { in: activeTaskStatuses } }, select: { id: true } })) continue;
    const scope = { organizationId: plan.organizationId, workspaceId: plan.workspaceId };
    // A new schedule slot is not new upstream permission. Retry only after
    // source/authorization revision changes, or a later approved task succeeds.
    const latest = await prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: target.id, executionVersion: 2, authorizationRevision: target.authorization.revision,
      frozenScope: { path: ["sourceRevision"], equals: target.revision } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { status: true, summary: true, trigger: true } });
    const failureCode = (latest?.summary as { quality?: { code?: string } } | null)?.quality?.code;
    if (latest?.status === "FAILED" && (failureCode === "AUTH" || failureCode === "API_REJECTED")) continue;
    // Recovery owns exhausted transient work, including its archived pages and
    // pending publication. A new cadence must not race the cooldown by creating
    // a replacement task with a different key and discarding that progress.
    if (latest?.status === "FAILED" && latest.trigger === "schedule" && automaticTransientFailureCodes.includes(failureCode ?? "")) continue;
    // Leave a completed boundary for the approved detail transition; don't
    // immediately race it with another base-only history window.
    if (plan.resource === "orders" && !parseOrderSyncPolicy(target.orderPolicy).details && target.resourceCursor?.status === "SUCCEEDED" && await continuityGrant(prisma, target) && await prisma.amazonOrderRecord.count({ where: { ...scope, sourceId: target.id } })) continue;

    let options: Parameters<typeof createTask>[4];
    let backfill = false;
    try {
      const adapter = automaticAdapter(plan.resource);
      if (!adapter) continue;
      const planned = await planAutomaticTask(adapter, scope, target, plan, now);
      if (!planned) continue;
      if (planned.deferUntil) {
        await prisma.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true }, data: { nextRunAt: planned.deferUntil } });
        continue;
      }
      options = { key: automaticTaskKey(plan, target, planned.keyFrom, planned.keyTo), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision,
        maxAttempts: plan.maxAttempts, priority: plan.priority, ...planned.payload };
      backfill = planned.backfill;
    } catch (error) {
      if (error instanceof SyncInputError && error.status === 409) {
        await prisma.$transaction(async tx => {
          await scopeLock(tx, scope);
          const recoveryRequired = error.message.startsWith("ORDER_WINDOW_REQUIRES_RECOVERY");
          const nextRunAt = new Date(now.getTime() + automaticResourceIntervalMinutes(plan.resource) * 60_000);
          const changed = await tx.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true, nextRunAt: { lte: now } }, data: { nextRunAt } });
          if (changed.count) await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: plan.updatedByUserId, action: "amazon.sync.plan.window-blocked", entityType: "AmazonSyncSchedule", entityId: plan.id, metadata: { workspaceId: scope.workspaceId, sourceId: target.id, resource: plan.resource, scheduleRevision: plan.revision, code: recoveryRequired ? "ORDER_WINDOW_REQUIRES_RECOVERY" : error.message.startsWith("SALES_HISTORY_EVIDENCE_LIMIT") ? "SALES_HISTORY_EVIDENCE_LIMIT" : "AUTOMATIC_WINDOW_BLOCKED", nextCheckAt: nextRunAt.toISOString(), taskCreated: false } } });
        });
      }
      continue;
    }
    try {
      const run = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope);
        const currentPlan = await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: plan.id, enabled: true, revision: plan.revision, nextRunAt: { lte: now }, targets: { some: { sourceId: target.id } } } });
        if (!currentPlan) return null;
        const created = await createTask(tx, scope, currentPlan.updatedByUserId, target.id, options);
        const nextRunAt = backfill ? new Date(now.getTime() + 60_000) : new Date(now.getTime() + plan.intervalMinutes * 60_000);
        await tx.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true }, data: { lastEnqueuedAt: now, nextRunAt } });
        return created;
      });
      if (run?.status === "WAITING") await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: run.id, dispatchVersion: run.dispatchVersion }, { jobId: `adc-${run.id}-${run.dispatchVersion}`, priority: run.priority, attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch { console.error(`[amazon-sync-center] automatic plan ${plan.id} could not enqueue; plan intent retained`); }
    } catch { console.error(`[amazon-sync-center] automatic plan ${plan.id} inspection deferred; other plans remain independent`); }
    finally {
      // A skipped or dependency-blocked plan cannot occupy every bounded scan.
      // Preserve disabled plans and any nextRunAt already advanced by planning.
      try {
        await prisma.amazonSyncSchedule.updateMany({ where: { organizationId: plan.organizationId, workspaceId: plan.workspaceId, id: plan.id, revision: plan.revision, enabled: true, nextRunAt: { lte: now } }, data: { nextRunAt: new Date(now.getTime() + 30_000) } });
      } catch { console.error(`[amazon-sync-center] automatic plan ${plan.id} inspection checkpoint deferred`); }
    }
  }
}

/** Block only this dispatch generation; a concurrently renewed run wins. */
async function blockIncrementalRun(run: SyncScope & { id: string; sourceId: string | null; resource: string; dispatchVersion: number; attempts: number; stage: string }, now: Date, message: string, code: string) {
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run);
    const changed = await tx.amazonSyncRun.updateMany({ where: { id: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId, dispatchVersion: run.dispatchVersion, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } }, data: { status: "BLOCKED", error: message, finishedAt: now, dispatchVersion: { increment: 1 } } });
    if (changed.count) {
      await syncIncrementalCursorStatus(tx, run, "BLOCKED");
      await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "BLOCKED", stage: run.stage, code } });
    }
  });
}
