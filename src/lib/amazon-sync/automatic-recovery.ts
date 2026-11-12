import { randomUUID } from "node:crypto";
import type { AmazonSyncResourceCursor, AmazonSyncRun, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonCloudExecutionEnabled } from "@/lib/amazon/execution-role";
import { assertAutomaticRecoveryAccess } from "./processor";
import { activeTaskStatuses, type SyncScope } from "./policy";
import { scopeLock, syncIncrementalCursorStatus } from "./service";
import { digest } from "./approval-policy";
import { domainReportHistoryCursorDigest } from "./domain-reports";
import { financeCursorDigest } from "./finance";
import { orderCursorDigest, parseOrderSyncPolicy } from "./orders";
import { returnCursorDigest } from "./returns";

export const automaticTransientFailureCodes = ["THROTTLE", "TRANSIENT", "DATABASE_TRANSIENT", "WORKER_INTERRUPTED"];
const transientCodes = automaticTransientFailureCodes;
const object = (value: unknown): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : {};

export function automaticRecoveryCursorIsCurrent(run: Pick<AmazonSyncRun, "id" | "resource" | "frozenScope" | "summary" | "pagesCompleted">, cursor: AmazonSyncResourceCursor | null) {
  if (!cursor || cursor.activeRunId === run.id) return true;
  const frozen = object(run.frozenScope), summary = object(run.summary), coverage = object(summary.coverage);
  if (run.resource === "orders" && frozen.orderHistoryReplay === true) {
    if (cursor.status !== "SUCCEEDED") return false;
    const checkpointDigest = coverage.cursorDigest;
    if (typeof checkpointDigest === "string") return checkpointDigest === orderCursorDigest(cursor);
    if (run.pagesCompleted !== 0) return false;
    const window = object(frozen.orderWindow), policy = parseOrderSyncPolicy(frozen.orderPolicy);
    const detailsDigest = policy.details ? digest(policy.details) : null;
    return typeof window.to === "string" && Date.parse(window.to) <= cursor.watermarkTo.getTime() && cursor.detailPolicyDigest === detailsDigest;
  }
  if (run.resource === "finance" && frozen.financeHistoryReplay === true) {
    return cursor.status === "SUCCEEDED" && frozen.financeHistoryCursorDigest === financeCursorDigest(cursor);
  }
  if (run.resource === "returns" && frozen.returnHistoryReplay === true) {
    return cursor.status === "SUCCEEDED" && frozen.returnHistoryCursorDigest === returnCursorDigest(cursor);
  }
  if (["reimbursements", "inventory_events"].includes(run.resource)) {
    const isReplay = run.resource === "reimbursements" ? frozen.reimbursementHistoryReplay === true : frozen.inventoryEventHistoryReplay === true;
    const expected = run.resource === "reimbursements" ? frozen.reimbursementHistoryCursorDigest : frozen.inventoryEventHistoryCursorDigest;
    return isReplay && cursor.status === "SUCCEEDED" && expected === domainReportHistoryCursorDigest(cursor);
  }
  return false;
}

/** Retry batches are bounded; persistent transient failures cool down up to a day.
 * Keep cumulative attempts, the original task and its frozen request identity.
 * Never revive manual, cancelled, paused, permission or parser failures.
 */
export async function recoverAutomaticFailures(scopes: SyncScope[], now: Date, taskIds?: string[]) {
  const result = { examined: 0, recovered: 0, deferred: 0 };
  if (!scopes.length || !amazonCloudExecutionEnabled()) return result;
  const candidates = await prisma.amazonSyncRun.findMany({ where: {
    OR: scopes, executionVersion: 2, trigger: "schedule", status: "FAILED", control: null,
    leaseOwner: null, leaseExpiresAt: null, finishedAt: { not: null }, nextAttemptAt: { lte: now },
    ...(taskIds ? { id: { in: taskIds } } : {}),
    AND: [{ OR: transientCodes.map(code => ({ summary: { path: ["quality", "code"], equals: code } })) }],
  }, orderBy: [{ nextAttemptAt: "asc" }, { finishedAt: "asc" }, { id: "asc" }], take: 100 });
  for (const candidate of candidates) {
    result.examined++;
    try {
      const recovered = await prisma.$transaction(async tx => {
        const scope = { organizationId: candidate.organizationId, workspaceId: candidate.workspaceId };
        await scopeLock(tx, scope);
        const run = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: candidate.id, dispatchVersion: candidate.dispatchVersion, status: "FAILED", trigger: "schedule", control: null, leaseOwner: null, leaseExpiresAt: null } });
        if (!run?.finishedAt || !run.sourceId || !run.scheduleId) return false;
        const summary = object(run.summary), quality = object(summary.quality), previous = object(summary.automaticRecovery);
        if (!transientCodes.includes(String(quality.code))) return false;
        const count = typeof previous.count === "number" && Number.isSafeInteger(previous.count) && previous.count >= 0 ? previous.count : 0;
        const cooldownMs = Math.min(24 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(count, 7));
        const eligibleAt = Math.max(run.finishedAt.getTime() + cooldownMs, run.nextAttemptAt.getTime());
        if (now.getTime() < eligibleAt) {
          await tx.amazonSyncRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(eligibleAt) } });
          return false;
        }
        const source = await assertAutomaticRecoveryAccess(tx, run);
        const plan = await tx.amazonSyncSchedule.findUniqueOrThrow({ where: { id: run.scheduleId } });
        if (source.activeRunId && source.activeRunId !== run.id) {
          const published = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: source.activeRunId }, select: { startedAt: true } });
          if (published && published.startedAt >= run.startedAt) return false;
        }
        // A newer cursor/task owns its own work. Never rewind it to an old failure.
        const cursor = await tx.amazonSyncResourceCursor.findFirst({ where: { ...scope, sourceId: source.id } });
        if (!automaticRecoveryCursorIsCurrent(run, cursor)) return false;
        if (await tx.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, id: { not: run.id }, status: { in: activeTaskStatuses } }, select: { id: true } })) return false;
        const nextMaxAttempts = Math.max(run.attempts, run.maxAttempts) + plan.maxAttempts;
        if (!Number.isSafeInteger(nextMaxAttempts) || nextMaxAttempts > 2147483647) return false;
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: {
          status: "RETRY_WAIT", finishedAt: null, nextAttemptAt: now, error: null,
          maxAttempts: nextMaxAttempts, dispatchVersion: { increment: 1 }, fenceVersion: { increment: 1 },
          summary: { ...summary, quality: { ...quality, status: "RETRYING_PARTIAL", retryScheduled: true },
            automaticRecovery: { count: count + 1, recoveredAt: now.toISOString(), reason: quality.code!, cooldownMs, previousMaxAttempts: run.maxAttempts } },
        } });
        await syncIncrementalCursorStatus(tx, run, "RETRY_WAIT");
        await tx.amazonSyncTaskLog.create({ data: { ...scope, id: randomUUID(), taskId: run.id, attempt: run.attempts, event: "AUTOMATIC_RECOVERY", stage: run.stage, code: String(quality.code) } });
        return true;
      });
      if (recovered) { result.recovered++; continue; }
      result.deferred++;
    } catch { result.deferred++; }
    // A stale authority, newer head or occupied source must not monopolize the
    // next bounded scan. This changes only the next inspection time: no grant,
    // task generation, checkpoint, error or terminal status is renewed.
    try {
      await prisma.amazonSyncRun.updateMany({ where: { id: candidate.id, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId,
        dispatchVersion: candidate.dispatchVersion, status: "FAILED", control: null, nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(now.getTime() + 15 * 60_000) } });
    } catch { /* A DB outage leaves durable intent for a later scheduler scan. */ }
  }
  return result;
}
