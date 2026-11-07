import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { unseal } from "./approval-policy";
import { parseObservationPolicy, type AnalyticsPolicy } from "./observation-policy";
import { observationOperation, parseObservationState } from "./observation-machine";

// Existing quota waits can put all contenders at the same future time. Keep
// their place through two scheduler minutes instead of letting early retries win.
export const brandFairLookaheadMs = 120_000;
export const brandFairCandidateLimit = 64;
export type BrandFairCandidate = { id: string; startedAt: Date; nextAttemptAt: Date; lastRequestAt: Date | null };
export function oldestBrandTurn(candidates: BrandFairCandidate[], now: Date) {
  return candidates.filter(c => c.nextAttemptAt.getTime() <= now.getTime() + brandFairLookaheadMs)
    .sort((a, b) => (a.lastRequestAt ?? a.startedAt).getTime() - (b.lastRequestAt ?? b.startedAt).getTime()
      || a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id))[0];
}

/** Called inside the existing scope + seller/operation locks. This selects a
 * turn, never grants execution: the caller's original fences and quota still run.
 * Invalid peers cannot hold the bucket hostage; only the chosen peer needs the
 * existing full access/revision validation. Logs are aggregated in one query.
 */
export async function brandFairTurn(tx: Prisma.TransactionClient, run: AmazonSyncRun, policy: AnalyticsPolicy, operation: string,
  validatePeer: (peer: AmazonSyncRun) => Promise<void>, now = new Date()) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const frozen = run.frozenScope as { authorizationId: string };
  const peers = await tx.amazonSyncRun.findMany({ where: { ...scope, resource: "brand_analytics", executionVersion: 2, control: null,
    status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"] },
    nextAttemptAt: { lte: new Date(now.getTime() + brandFairLookaheadMs) },
    frozenScope: { path: ["domainPolicy", "applicationId"], equals: policy.applicationId },
    source: { enabled: true, authorizationId: frozen.authorizationId },
  }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: brandFairCandidateLimit + 1 });
  const wait = () => ({ allowed: false, nextAt: new Date(now.getTime() + 5000) });
  if (peers.length > brandFairCandidateLimit) return wait();
  const candidates = peers.filter(peer => {
    try {
      const p = parseObservationPolicy((peer.frozenScope as { domainPolicy?: unknown }).domainPolicy, "brand_analytics") as AnalyticsPolicy;
      if (p.applicationId !== policy.applicationId) return false;
      const state = parseObservationState(peer.checkpointCiphertext ? unseal(peer.checkpointCiphertext, scope, peer.id, "amazon-observation-state.v1").state : null, p);
      return state.requests < p.maxRequests && observationOperation(state, "brand_analytics") === operation;
    } catch { return false; }
  });
  if (!candidates.some(peer => peer.id === run.id)) return wait();
  const activity = await tx.amazonSyncTaskLog.groupBy({ by: ["taskId"], where: { ...scope, taskId: { in: candidates.map(p => p.id) }, stage: "REQUEST", event: operation }, _max: { createdAt: true } });
  const last = new Map(activity.map(a => [a.taskId, a._max.createdAt]));
  const remaining = candidates.map(p => ({ id: p.id, startedAt: p.startedAt, nextAttemptAt: p.nextAttemptAt, lastRequestAt: last.get(p.id) ?? null }));
  while (remaining.length) {
    const first = oldestBrandTurn(remaining, now)!;
    if (first.id === run.id) return { allowed: true, nextAt: now };
    try { await validatePeer(candidates.find(p => p.id === first.id)!); }
    catch { remaining.splice(remaining.indexOf(first), 1); continue; }
    return { allowed: false, nextAt: new Date(Math.max(now.getTime() + 5000, first.nextAttemptAt.getTime())) };
  }
  return wait();
}
