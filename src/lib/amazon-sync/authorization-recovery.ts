import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { digest } from "./approval-policy";
import { matchesAuthorizationHistory } from "./history-authorization";
import { automaticTransientFailureCodes } from "./automatic-recovery";
import { assertAutomaticRecoveryAccess } from "./processor";
import { activeTaskStatuses, type SyncScope } from "./policy";
import { scopeLock, syncIncrementalCursorStatus } from "./service";

/** A verified credential renewal can rebind an unchanged automatic request to
 * the current live plan. It is not a renewal of manual execution approvals.
 * Audit the previous frozen scope before changing its credential revision;
 * request windows, archive identities and cursor ciphertext remain unchanged.
 */
export async function recoverRenewedAuthorizations(scopes: SyncScope[], now: Date, options?: { authorizationId?: string; taskIds?: string[]; forceInspection?: boolean }) {
  const result = { examined: 0, recovered: 0, deferred: 0 };
  if (!scopes.length || !amazonCloudExecutionEnabled()) return result;
  const authorizations = await prisma.amazonSpApiAuthorization.findMany({ where: { OR: scopes, ...(options?.authorizationId ? { id: options.authorizationId } : {}),
    status: "CONFIGURED", identityVerifiedAt: { not: null }, lastValidatedAt: { not: null }, revision: { gt: 1 } }, select: { id: true, organizationId: true, workspaceId: true, revision: true } });
  for (const authorization of authorizations) {
    const scope = { organizationId: authorization.organizationId, workspaceId: authorization.workspaceId };
    const runs = await prisma.amazonSyncRun.findMany({ where: { ...scope, executionVersion: 2, trigger: "schedule", control: null,
      stage: { not: "PURGED" }, source: { authorizationId: authorization.id }, authorizationRevision: { gt: 0, lt: authorization.revision },
      ...(options?.taskIds ? { id: { in: options.taskIds } } : {}), ...(!options?.forceInspection ? { nextAttemptAt: { lte: now } } : {}),
      OR: [{ status: { in: ["WAITING", "QUEUED", "RETRY_WAIT"] } },
        { status: "BLOCKED", logs: { some: { event: "BLOCKED", code: "PREFLIGHT_REJECTED" } } },
        { status: "FAILED", OR: [...["AUTH", ...automaticTransientFailureCodes].map(code => ({ summary: { path: ["quality", "code"], equals: code } })),
          { summary: { path: ["quality", "code"], equals: "API_REJECTED" }, logs: { some: { stage: "REQUEST", statusCode: 403 } } }] }],
    }, orderBy: [{ nextAttemptAt: "asc" }, { startedAt: "asc" }, { id: "asc" }], take: 100 });
    for (const candidate of runs) {
      result.examined++;
      try {
        const recovered = await prisma.$transaction(async tx => {
          await scopeLock(tx, scope);
          const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: candidate.id, dispatchVersion: candidate.dispatchVersion, status: candidate.status, trigger: "schedule", control: null } });
          if (!run?.sourceId || !run.frozenScope || digest(run.frozenScope) !== run.frozenScopeDigest) return false;
          const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId, enabled: true, authorizationId: authorization.id }, include: { authorization: true, resourceCursor: true } });
          const frozen = run.frozenScope as Prisma.JsonObject;
          if (!source || source.authorization.revision !== authorization.revision || source.authorization.status !== "CONFIGURED"
            || !source.authorization.identityVerifiedAt || !source.authorization.lastValidatedAt || !source.authorization.amazonSellerId
            || frozen.authorizationRevision !== run.authorizationRevision || !matchesAuthorizationHistory(source, frozen)) return false;
          if (run.status === "FAILED" && (run.summary as { quality?: { code?: string } } | null)?.quality?.code === "API_REJECTED") {
            const request = await tx.amazonSyncTaskLog.findFirst({ where: { ...scope, taskId: run.id, stage: "REQUEST", statusCode: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { statusCode: true } });
            if (request?.statusCode !== 403) return false;
          }
          if (source.resourceCursor && (source.resourceCursor.activeRunId !== run.id || source.resourceCursor.status === "SUCCEEDED")) return false;
          if (source.activeRunId && source.activeRunId !== run.id) {
            const head = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: source.activeRunId }, select: { startedAt: true } });
            if (head && head.startedAt >= run.startedAt) return false;
          }
          if (await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, id: { not: run.id }, status: { in: activeTaskStatuses } }, select: { id: true } })) return false;
          const renewed = { ...frozen, authorizationRevision: authorization.revision };
          // Run every current permission, plan, policy and revision check against
          // the proposed binding before saving it. Failed checks renew nothing.
          await assertAutomaticRecoveryAccess(tx, { ...run, frozenScope: renewed, frozenScopeDigest: digest(renewed), authorizationRevision: authorization.revision });
          const plan = await tx.amazonSyncSchedule.findUniqueOrThrow({ where: { id: run.scheduleId! } });
          const nextMax = Math.max(run.maxAttempts, run.attempts + plan.maxAttempts);
          if (nextMax > 2147483647) return false;
          await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: run.requestedByUserId, action: "amazon.sync.authorization.task-rebound", entityType: "AmazonSyncRun", entityId: run.id,
            metadata: { workspaceId: scope.workspaceId, sourceId: source.id, authorizationId: authorization.id, fromRevision: run.authorizationRevision,
              toRevision: authorization.revision, previousFrozenScope: run.frozenScope, previousFrozenScopeDigest: run.frozenScopeDigest,
              renewedFrozenScopeDigest: digest(renewed), scheduleId: run.scheduleId, scheduleRevision: run.scheduleRevision, checkpointPreserved: true, previousStatus: run.status } } });
          await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "WAITING", error: null, finishedAt: null, leaseOwner: null, leaseExpiresAt: null,
            authorizationRevision: authorization.revision, frozenScope: renewed, frozenScopeDigest: digest(renewed),
            nextAttemptAt: run.status === "FAILED" || run.status === "BLOCKED" ? now : new Date(Math.max(now.getTime(), run.nextAttemptAt.getTime())),
            dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 }, maxAttempts: nextMax } });
          await syncIncrementalCursorStatus(tx, run, "WAITING");
          await tx.amazonSyncTaskLog.create({ data: { ...scope, id: randomUUID(), taskId: run.id, attempt: run.attempts, event: "AUTHORIZATION_REBOUND", stage: run.stage } });
          return true;
        });
        if (recovered) { result.recovered++; continue; }
        result.deferred++;
      } catch { result.deferred++; }
      try { await prisma.amazonSyncRun.updateMany({ where: { ...scope, id: candidate.id, dispatchVersion: candidate.dispatchVersion, status: candidate.status, control: null, nextAttemptAt: { lte: now } }, data: { nextAttemptAt: new Date(now.getTime() + 15 * 60_000) } }); }
      catch { /* Persistent old binding remains safe for the next scheduler. */ }
    }
  }
  return result;
}
