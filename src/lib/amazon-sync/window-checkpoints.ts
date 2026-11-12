import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { historicalTarget, intervalCoverage, successfulWindow } from "./coverage";
import { authorizationHistoryWhere } from "./history-authorization";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const historyLimit = 1000;
const resources = new Set(["orders", "finance", "returns", "sales_traffic", "inventory_events", "reimbursements"]);
type EvidenceRun = Pick<AmazonSyncRun, "id" | "resource" | "status" | "stage" | "paginationComplete" | "frozenScope" | "summary" | "finishedAt">;

/** Requested scope only; never substitutes this interval for business completeness. */
export function transportedWindow(run: EvidenceRun) {
  if (!run.finishedAt || !run.paginationComplete || !["SUCCEEDED", "PARTIAL_SUCCESS"].includes(run.status) || run.stage === "PURGED") return null;
  const frozen = record(run.frozenScope);
  const window = record(frozen.orderWindow ?? frozen.financeWindow ?? frozen.returnWindow ?? frozen.requestedRange ?? frozen.reportWindow);
  if (typeof window.from !== "string" || typeof window.to !== "string") return null;
  const from = Date.parse(window.from), to = Date.parse(window.to) + (/^\d{4}-\d{2}-\d{2}$/.test(window.to) ? 86400000 : 0);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

export function completeWindow(run: EvidenceRun) {
  if (run.status !== "SUCCEEDED" || !run.finishedAt) return null;
  const window = successfulWindow(run);
  return window && window.to > window.from ? window : null;
}

export function summarizeWindowCheckpoints(runs: EvidenceRun[], target: { from: number; to: number } | null, truncated: boolean) {
  // Callers supply newest finishedAt/id first. Completion time and interval end
  // are separate: a later backfill must not erase evidence of a newer interval.
  const checkpoint = (kind: "transport" | "complete") => {
    let selected: { taskId: string; finishedAt: string; from: string; toExclusive: string } | null = null;
    for (const run of runs) {
      const window = kind === "transport" ? transportedWindow(run) : completeWindow(run);
      if (window && (!selected || window.to > Date.parse(selected.toExclusive))) selected = {
        taskId: run.id, finishedAt: run.finishedAt!.toISOString(), from: new Date(window.from).toISOString(), toExclusive: new Date(window.to).toISOString(),
      };
    }
    // A bounded scan cannot establish a maximum over omitted evidence.
    return truncated ? null : selected;
  };
  const measured = target && !truncated ? intervalCoverage(target, runs.flatMap(run => { const window = completeWindow(run); return window ? [window] : []; })) : null;
  return {
    version: 1, intervalConvention: "FROM_INCLUSIVE_TO_EXCLUSIVE", evidenceTruncated: truncated,
    lastTransportWindow: checkpoint("transport"), lastCompleteWindow: checkpoint("complete"),
    history: { applicable: !!target, target: target ? { from: new Date(target.from).toISOString(), toExclusive: new Date(target.to).toISOString() } : null,
      complete: measured?.complete ?? false, percent: measured?.percent ?? null,
      coveredMilliseconds: measured?.coveredMs ?? null, expectedMilliseconds: measured?.expectedMs ?? null,
      gapCount: measured?.gaps.length ?? null, gaps: measured?.gaps.slice(0, 100) ?? [], gapsTruncated: (measured?.gaps.length ?? 0) > 100 },
    schedulingSeparated: false,
  };
}

/** Caller holds the existing scope lock and run fence. Only terminal window
 * commits invoke this; no extra scan per page, new queue or schema migration. */
export async function persistWindowCheckpoints(tx: Prisma.TransactionClient, run: AmazonSyncRun, checkedAt: Date) {
  if (!run.sourceId || !resources.has(run.resource)) return;
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId }, include: { authorization: { select: { revision: true, amazonSellerId: true, identityVerifiedAt: true } } } });
  if (!source) return;
  const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id, executionVersion: 2,
    status: { in: ["SUCCEEDED", "PARTIAL_SUCCESS"] }, finishedAt: { not: null }, stage: { not: "PURGED" },
    AND: [authorizationHistoryWhere(source),
      { frozenScope: { path: ["sourceRevision"], equals: source.revision } }] },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: historyLimit + 1,
    select: { id: true, resource: true, status: true, stage: true, paginationComplete: true, frozenScope: true, summary: true, finishedAt: true } });
  const target = historicalTarget(source, checkedAt);
  // Retention gaps are evidence, not policy defaults: moving initialFrom must
  // not silently remove a previously observed missing historical interval.
  for (const coverage of [record(source.coverage), ...runs.map(item => record(record(item.summary).coverage))]) {
    const gaps = Array.isArray(coverage.retentionGaps) ? coverage.retentionGaps : coverage.retentionGap ? [coverage.retentionGap] : [];
    for (const gap of gaps) { const from = record(gap).from; if (target && typeof from === "string" && Number.isFinite(Date.parse(from))) target.from = Math.min(target.from, Date.parse(from)); }
  }
  const evidence = { ...summarizeWindowCheckpoints(runs.slice(0, historyLimit), target, runs.length > historyLimit),
    checkedAt: checkedAt.toISOString(), triggerTaskId: run.id, sourceRevision: source.revision,
    authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision,
    basis: "CURRENT_SOURCE_AND_AUTHORIZATION_REVISION", evidenceLimit: historyLimit };
  const current = runs.find(item => item.id === run.id);
  if (current) {
    const transport = transportedWindow(current), complete = completeWindow(current);
    await tx.amazonSyncRun.update({ where: { id: current.id }, data: { summary: { ...record(current.summary), windowCheckpoint: {
      version: 1, checkedAt: checkedAt.toISOString(), sourceRevision: source.revision,
      authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision,
      intervalConvention: "FROM_INCLUSIVE_TO_EXCLUSIVE",
      window: transport ? { from: new Date(transport.from).toISOString(), toExclusive: new Date(transport.to).toISOString() } : null,
      transportComplete: !!transport, coverageComplete: !!complete,
      historicalCompleteAtCheck: evidence.history.complete, evidenceTruncated: evidence.evidenceTruncated,
      // Coverage completeness does not certify every optional field, FX
      // conversion, every return channel or final financial settlement.
      basis: "REGISTERED_RESOURCE_WINDOW_COVERAGE",
    } } as Prisma.InputJsonObject } });
  }
  await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { coverage: { ...record(source.coverage), windowCheckpoints: evidence } as Prisma.InputJsonObject } });
}
