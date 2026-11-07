import { nextBrandCollectionPolicy } from "./brand-collection-query";
import { brandWindowKey } from "./brand-collection";
import { continuityGrant } from "./continuity-access";
import { maintainContinuity } from "./continuity";
import { automaticTaskKey } from "./automatic-schedule";
import { ensureAutomaticConnections } from "./automatic-connection";
import { assertExecutionWindow } from "./execution-window";
import { dispatchSalesExports } from "./exports";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { getAmazonSyncQueue } from "@/lib/queue/redis-queue";
import { createTask, scopeLock, syncIncrementalCursorStatus } from "./service";
import { activeTaskStatuses, isIncrementalResource, SyncInputError, type SyncScope } from "./policy";
import { financeWindowFromFrozen, nextFinanceWindow, parseFinancePolicy } from "./finance";
import { nextOrderWindow, orderWindowFromFrozen, parseOrderSyncPolicy } from "./orders";
import { parseReturnPolicy, returnWindowFromFrozen } from "./returns";
import { domainReportRunWindow } from "./domain-reports";
import { isObservationResource, parseObservationPolicy } from "./observation-policy";
import { nextAutomaticInventoryEventWindow, nextAutomaticReimbursementWindow, latestClosedReimbursementWindow, nextAutomaticReturnWindow, nextAutomaticSettlementDiscovery, nextSalesTrafficRange, automaticBackfillStart, automaticIntervalMinutes, automaticMarketplaces, automaticMarketplaceAllowed, automaticPlanId, automaticPlanKey, automaticResources, isAutomaticResource } from "./automatic-schedule";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";

export function enabledSyncScopes(value = process.env.AMAZON_SYNC_CENTER_SCOPES): SyncScope[] {
  try {
    const rows: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is [string, string] => Array.isArray(r) && r.length === 2 && r.every(v => typeof v === "string" && v.length > 0 && v.length < 201)).map(([organizationId, workspaceId]) => ({ organizationId, workspaceId }));
  } catch { return []; }
}

/** Persist the first automatic work for one validated authorization before relying on Redis. */
export async function ensureAmazonSyncInitialized(scope: SyncScope, authorizationId: string, now = new Date()) {
  const enabled = enabledSyncScopes().some(candidate => candidate.organizationId === scope.organizationId && candidate.workspaceId === scope.workspaceId);
  if (!enabled) return { status: "scope_disabled" as const, sourceCount: 0, planCount: 0, taskCount: 0 };
  if (!process.env.DATABASE_URL) return { status: "database_unavailable" as const, sourceCount: 0, planCount: 0, taskCount: 0 };

  const beforeSources = await prisma.amazonSyncDataSource.count({ where: { ...scope, authorizationId } });
  const beforePlans = await prisma.amazonSyncSchedule.count({ where: { ...scope, executionVersion: 2, planKey: { startsWith: "auto-v1:" }, targets: { some: { source: { authorizationId } } } } });
  await ensureAutomaticConnections([scope], now, authorizationId);
  const sourceIds = (await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId }, select: { id: true } })).map(source => source.id);
  if (!sourceIds.length) return { status: "no_eligible_sources" as const, sourceCount: 0, planCount: 0, taskCount: 0 };
  await ensureAutomaticSchedules([scope], now, sourceIds);
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
  const scopes = enabledSyncScopes();
  if (!scopes.length || !process.env.DATABASE_URL || process.env.QUEUE_DRIVER !== "redis") return;
  await dispatchSalesExports(scopes, only?.exportIds);
  if (!only) {
    await maintainContinuity(scopes, now);
    await ensureAutomaticConnections(scopes, now);
    await ensureAutomaticSchedules(scopes, now);
    await enqueueDueAutomaticPlans(scopes, now);
  }
  const expired = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: "RUNNING", leaseExpiresAt: { lt: now } }, take: 100 });
  for (const run of expired) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, run);
      const changed = await tx.amazonSyncRun.updateMany({ where: { id: run.id, status: "RUNNING", fenceVersion: run.fenceVersion, leaseExpiresAt: { lt: now } }, data: { status: run.attempts >= run.maxAttempts ? "FAILED" : "RETRY_WAIT", stage: run.stage, fenceVersion: { increment: 1 }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, finishedAt: run.attempts >= run.maxAttempts ? now : null, error: "任务租约过期；从已提交分页检查点恢复，旧执行器不能发布。" } });
      if (changed.count) await syncIncrementalCursorStatus(tx, run, run.attempts >= run.maxAttempts ? "FAILED" : "RETRY_WAIT");
      if (changed.count) await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: "LEASE_EXPIRED", stage: run.stage, code: "INTERRUPTED" } });
    });
  }
  const pending = await prisma.amazonSyncRun.findMany({ where: { OR: scopes, ...(only ? { id: { in: only.taskIds } } : {}), executionVersion: 2, status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] }, nextAttemptAt: { lte: new Date(Math.max(now.getTime(), Date.now())) } }, orderBy: [{ priority: "asc" }, { nextAttemptAt: "asc" }], take: 100 });
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
    } catch { console.error(`[amazon-sync-center] task ${run.id} dispatch deferred; intent retained`); }
  }
}

async function ensureAutomaticSchedules(scopes: SyncScope[], now: Date, sourceIds?: string[]) {
  const sources = await prisma.amazonSyncDataSource.findMany({
    where: { OR: scopes, ...(sourceIds ? { id: { in: sourceIds } } : {}), enabled: true, resource: { in: [...automaticResources] }, marketplaceId: { in: [...automaticMarketplaces] }, authorization: { status: "CONFIGURED" } },
    include: { authorization: { select: { updatedByUserId: true } }, resourceCursor: true }, take: 200,
  });
  for (const candidate of sources) {
    // Brand collection is opt-in through an explicitly approved save-plan.
    if (candidate.resource === "brand_analytics") continue;
    if ((candidate.resource === "orders" && !candidate.orderPolicy) || (candidate.resource === "finance" && !candidate.financePolicy) || (candidate.resource === "returns" && !candidate.returnsPolicy) || (isObservationResource(candidate.resource) && !candidate.domainPolicy)) continue;
    const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
    try { await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: candidate.id, authorization: { status: "CONFIGURED" } }, include: { authorization: { select: { updatedByUserId: true } } } });
      if (!source || !source.enabled) return;
      const key = automaticPlanKey(source.id);
      const exists = await tx.amazonSyncSchedule.findUnique({ where: { organizationId_workspaceId_resource_planKey: { ...scope, resource: source.resource, planKey: key } }, select: { id: true } });
      if (exists) return;
      await assertAmazonScopeAdmin(scope, source.authorization.updatedByUserId, tx);
      await assertAmazonAction(scope, source.authorization.updatedByUserId, "create", tx);
      await assertAmazonAction(scope, source.authorization.updatedByUserId, "approve", tx);
      if (await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, status: { in: activeTaskStatuses } }, select: { id: true } })) return;
      const backfillStart = source.resource === "finance" && source.financePolicy ? parseFinancePolicy(source.financePolicy).initialFrom : automaticBackfillStart(now);
      if (source.resource === "orders" && source.orderPolicy) {
        const policy = { ...parseOrderSyncPolicy(source.orderPolicy), initialFrom: backfillStart, windowMinutes: 1440 };
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { orderPolicy: policy as Prisma.InputJsonValue, revision: { increment: 1 } } });
      }
      if (source.resource === "finance" && source.financePolicy) {
        // The source already records its chosen retention start and gap. Do not
        // erase them when creating a plan or move an existing cursor implicitly.
        const policy = { ...parseFinancePolicy(source.financePolicy), windowMinutes: 43200 };
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { financePolicy: policy as Prisma.InputJsonValue, revision: { increment: 1 } } });
      }
      if (source.resource === "returns" && source.returnsPolicy) {
        const policy = { ...parseReturnPolicy(source.returnsPolicy), initialFrom: backfillStart, windowMinutes: 43200 };
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { returnsPolicy: policy as Prisma.InputJsonValue, revision: { increment: 1 } } });
      }
      const id = automaticPlanId(source.id);
      const plan = await tx.amazonSyncSchedule.create({ data: { ...scope, id, resource: source.resource, executionVersion: 2, planKey: key, name: `自动同步 · ${source.resource}`, revision: 1, mode: source.resource === "sales_traffic" ? "date_range" : isIncrementalResource(source.resource) ? "incremental" : "snapshot", priority: 1, maxAttempts: 3, retentionDays: 30, nextRunAt: now, intervalMinutes: automaticIntervalMinutes, enabled: true, updatedByUserId: source.authorization.updatedByUserId } });
      await tx.amazonSyncPlanTarget.create({ data: { ...scope, scheduleId: plan.id, sourceId: source.id } });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: source.authorization.updatedByUserId, action: "amazon.sync.plan.automatic_created", entityType: "AmazonSyncSchedule", entityId: plan.id, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, resource: source.resource, marketplaceId: source.marketplaceId, ...(source.resource === "orders" || source.resource === "finance" || source.resource === "returns" ? { initialFrom: backfillStart } : {}), ...(source.resource === "inventory_events" ? { initialFrom: new Date(now.getTime() - 540 * 86_400_000).toISOString() } : {}) } } });
    }); } catch { console.error(`[amazon-sync-center] automatic plan discovery deferred for source ${candidate.id}`); }
  }
}

export async function enqueueDueAutomaticPlans(scopes: SyncScope[], now: Date, sourceIds?: string[]) {
  const plans = await prisma.amazonSyncSchedule.findMany({ where: { OR: scopes, executionVersion: 2, enabled: true, planKey: { startsWith: "auto-v1:" }, ...(sourceIds ? { targets: { some: { sourceId: { in: sourceIds } } } } : {}), nextRunAt: { lte: now } }, include: { targets: { include: { source: { include: { authorization: true, seller: true, resourceCursor: true } } } } }, orderBy: { nextRunAt: "asc" }, take: 100 });
  for (const plan of plans) {
    if (!isAutomaticResource(plan.resource)) continue;
    const target = plan.targets[0]?.source;
    if (!target || !target.enabled || plan.targets.length !== 1 || target.authorization.status !== "CONFIGURED" || !automaticMarketplaceAllowed(plan.resource, target.marketplaceId)) continue;
    if (await prisma.amazonSyncRun.findFirst({ where: { organizationId: plan.organizationId, workspaceId: plan.workspaceId, sourceId: target.id, status: { in: activeTaskStatuses } }, select: { id: true } })) continue;
    const scope = { organizationId: plan.organizationId, workspaceId: plan.workspaceId };
    // Leave a completed boundary for the approved detail transition; don't
    // immediately race it with another base-only history window.
    if (plan.resource === "orders" && !parseOrderSyncPolicy(target.orderPolicy).details && target.resourceCursor?.status === "SUCCEEDED" && await continuityGrant(prisma, target) && await prisma.amazonOrderRecord.count({ where: { ...scope, sourceId: target.id } })) continue;

    let options: Parameters<typeof createTask>[4];
    let backfill = false;
    try {
      if (plan.resource === "brand_analytics") {
        const brandPolicy = await nextBrandCollectionPolicy(prisma, scope, target);
        options = { key: automaticTaskKey(plan, target, brandWindowKey(brandPolicy)), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, brandPolicy };
        backfill = true;
      } else if (plan.resource === "orders") {
        if (!target.orderPolicy) continue;
        const policy = parseOrderSyncPolicy(target.orderPolicy);
        const cursor = target.resourceCursor;
        const window = nextOrderWindow(policy, cursor && cursor.status !== "SUCCEEDED" ? cursor : plan.lastEnqueuedAt ? cursor : null, now);
        options = { key: automaticTaskKey(plan, target, window.from, window.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, orderWindow: orderWindowFromFrozen(window) };
        backfill = Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000;
      } else if (plan.resource === "finance") {
        if (!target.financePolicy) continue;
        const policy = parseFinancePolicy(target.financePolicy);
        const cursor = target.resourceCursor;
        const window = nextFinanceWindow(policy, cursor && cursor.status !== "SUCCEEDED" ? cursor : plan.lastEnqueuedAt ? cursor : null, now);
        options = { key: automaticTaskKey(plan, target, window.from, window.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, financeWindow: financeWindowFromFrozen(window) };
        backfill = Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000;
      } else if (plan.resource === "returns") {
        if (!target.returnsPolicy) continue;
        const policy = parseReturnPolicy(target.returnsPolicy);
        const window = nextAutomaticReturnWindow(policy, target.resourceCursor, now);
        options = { key: automaticTaskKey(plan, target, window.from, window.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, returnWindow: returnWindowFromFrozen(window) };
        backfill = Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000;
      } else if (plan.resource === "sales_traffic") {
        const history = await prisma.amazonSyncRun.findMany({ where: { ...scope, sourceId: target.id, resource: "sales_traffic", status: "SUCCEEDED", stage: "COMPLETED" }, select: { frozenScope: true }, orderBy: { finishedAt: "desc" }, take: 1000 });
        const coverage = history.flatMap(run => { const range = (run.frozenScope as { requestedRange?: { from?: unknown; to?: unknown } } | null)?.requestedRange; return typeof range?.from === "string" && typeof range?.to === "string" ? [{ from: range.from, to: range.to }] : []; });
        const next = nextSalesTrafficRange(target.marketplaceId, now, coverage);
        options = { key: automaticTaskKey(plan, target, next.range.from, next.range.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, requestedRange: next.range };
        backfill = next.backfill;
      } else if (plan.resource === "inventory_events") {
        const window = nextAutomaticInventoryEventWindow(target.resourceCursor, now);
        if (!window) {
          await prisma.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true }, data: { nextRunAt: new Date(now.getTime() + automaticIntervalMinutes * 60_000) } });
          continue;
        }
        const checked = domainReportRunWindow("inventory_events", window);
        options = { key: automaticTaskKey(plan, target, window.from, window.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, reportWindow: checked! };
        backfill = window.to < new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      } else if (plan.resource === "settlements") {
        const window = nextAutomaticSettlementDiscovery(now, target.resourceCursor);
        options = { key: automaticTaskKey(plan, target, window.createdSince.slice(0, 10), window.createdUntil.slice(0, 10)), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, reportWindow: domainReportRunWindow("settlements", window)! };
      } else if (plan.resource === "reimbursements") {
        const window = target.resourceCursor ? nextAutomaticReimbursementWindow(now, target.resourceCursor) : latestClosedReimbursementWindow(now);
        options = { key: automaticTaskKey(plan, target, window.from, window.to), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority, reportWindow: window };
        backfill = window.to < new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      } else if (plan.resource === "inventory_age") {
        options = { key: automaticTaskKey(plan, target, now.toISOString().slice(0, 10)), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority };
      } else if (plan.resource === "catalog" || plan.resource === "inventory") {
        options = { key: automaticTaskKey(plan, target, now.toISOString().slice(0, 10)), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority };
      } else {
        if (!isObservationResource(plan.resource) || !target.domainPolicy) continue;
        const policy = parseObservationPolicy(target.domainPolicy, plan.resource);
        if (["brand_analytics", "buy_box_history"].includes(policy.resource)) continue;
        options = { key: automaticTaskKey(plan, target, now.toISOString().slice(0, 10)), trigger: "schedule", scheduleId: plan.id, scheduleRevision: plan.revision, maxAttempts: plan.maxAttempts, priority: plan.priority };
      }
    } catch (error) {
      if (error instanceof SyncInputError && error.status === 409) {
        await prisma.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true }, data: { nextRunAt: new Date(now.getTime() + automaticIntervalMinutes * 60_000) } });
      }
      continue;
    }
    try {
      const run = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope);
        const currentPlan = await tx.amazonSyncSchedule.findFirst({ where: { ...scope, id: plan.id, enabled: true, revision: plan.revision, nextRunAt: { lte: now }, targets: { some: { sourceId: target.id } } } });
        if (!currentPlan) return null;
        const created = await createTask(tx, scope, currentPlan.updatedByUserId, target.id, options);
        const nextRunAt = backfill ? new Date(now.getTime() + 60_000) : new Date(now.getTime() + automaticIntervalMinutes * 60_000);
        await tx.amazonSyncSchedule.updateMany({ where: { ...scope, id: plan.id, revision: plan.revision, enabled: true }, data: { lastEnqueuedAt: now, nextRunAt } });
        return created;
      });
      if (run?.status === "WAITING") await getAmazonSyncQueue().add("process-amazon-sync-run", { runId: run.id, dispatchVersion: run.dispatchVersion }, { jobId: `adc-${run.id}-${run.dispatchVersion}`, priority: run.priority, attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch { console.error(`[amazon-sync-center] automatic plan ${plan.id} could not enqueue; plan intent retained`); }
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
