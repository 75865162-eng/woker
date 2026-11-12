import { registeredSpApiSchemas } from "./official-schema";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { syncDomains, SyncInputError, type SyncScope } from "./policy";
import { localDate, reportTimeZone, shiftDate } from "./date-range";
import { hasCompleteReportAttributionProof, hasReadableReportAttributionProof, requiresReportRowAttribution } from "./report-row-attribution";
import { readBrandCollection } from "./brand-collection-query";
import { matchesAuthorizationHistory } from "./history-authorization";

type Window = { from: number; to: number };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const dayMs = 86_400_000;

/** Union, never min/max: a failed interval must remain a real gap. */
export function intervalCoverage(target: Window, windows: Window[]) {
  const ordered = windows.filter(w => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to > w.from)
    .map(w => ({ from: Math.max(target.from, w.from), to: Math.min(target.to, w.to) })).filter(w => w.to > w.from).sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Window[] = [];
  for (const window of ordered) {
    const previous = merged.at(-1);
    if (previous && window.from <= previous.to) previous.to = Math.max(previous.to, window.to);
    else merged.push({ ...window });
  }
  let cursor = target.from;
  const gaps: Window[] = [];
  for (const window of merged) { if (window.from > cursor) gaps.push({ from: cursor, to: window.from }); cursor = Math.max(cursor, window.to); }
  if (cursor < target.to) gaps.push({ from: cursor, to: target.to });
  const expectedMs = Math.max(0, target.to - target.from), coveredMs = merged.reduce((sum, w) => sum + w.to - w.from, 0);
  return { expectedMs, coveredMs, percent: expectedMs ? coveredMs === expectedMs ? 100 : Math.min(99.99, Math.floor(coveredMs / expectedMs * 10000) / 100) : null,
    complete: expectedMs > 0 && gaps.length === 0, gaps: gaps.map(w => ({ from: new Date(w.from).toISOString(), toExclusive: new Date(w.to).toISOString() })) };
}

export function historicalTarget(source: { resource: string; marketplaceId: string; orderPolicy: unknown; financePolicy: unknown; returnsPolicy: unknown; domainPolicy?: unknown }, now: Date): Window | null {
  const policy = record(source.resource === "orders" ? source.orderPolicy : source.resource === "finance" ? source.financePolicy : source.returnsPolicy);
  if (["orders", "finance", "returns"].includes(source.resource)) {
    const configuredFrom = time(policy.initialFrom), lag = Number(policy.safetyLagSeconds);
    const from = source.resource === "finance" ? configuredFrom : configuredFrom === null ? null : Math.min(configuredFrom, now.getTime() - 730 * dayMs);
    return from !== null && Number.isFinite(lag) && lag >= 0 ? { from, to: now.getTime() - lag * 1000 } : null;
  }
  if (source.resource === "buy_box_history") {
    const configured = record(source.domainPolicy), from = time(configured.from);
    return from === null ? null : { from, to: Date.parse(localDate(now, reportTimeZone(source.marketplaceId))) };
  }
  if (["sales_traffic", "inventory_events", "reimbursements"].includes(source.resource)) {
    const today = source.resource === "sales_traffic" ? localDate(now, reportTimeZone(source.marketplaceId)) : now.toISOString().slice(0, 10);
    return { from: Date.parse(shiftDate(today, source.resource === "inventory_events" ? -540 : -730)), to: Date.parse(today) };
  }
  if (source.resource === "settlements") return { from: now.getTime() - 90 * dayMs, to: now.getTime() };
  return null;
}

export function successfulWindow(run: { resource: string; stage: string; paginationComplete: boolean; frozenScope: unknown; summary: unknown }): Window | null {
  if (!run.paginationComplete || run.stage.includes("ARCHIVED") || run.stage === "PURGED") return null;
  const frozen = record(run.frozenScope), coverage = record(record(run.summary).coverage);
  if (run.resource === "inventory_events" && record(frozen.reportWindow).eventType !== "") return null;
  if (run.resource === "returns" && coverage.returnsUniverseComplete === false) return null;
  // A completed transport is not evidence that quarantined financial facts
  // have been attributed. Legacy runs without an explicit count stay unknown.
  if (run.resource === "finance" && coverage.quarantinedCount !== 0) return null;
  if (coverage.complete === false || coverage.attributionComplete === false || coverage.transportComplete === false) return null;
  if (![coverage.complete, coverage.transportComplete, coverage.attributionComplete].includes(true)) return null;
  const raw = record(frozen.orderWindow ?? frozen.financeWindow ?? frozen.returnWindow ?? frozen.requestedRange ?? frozen.reportWindow ?? (run.resource === "buy_box_history" ? frozen.domainPolicy : undefined));
  const from = time(raw.from ?? raw.createdSince), to = time(raw.to ?? raw.createdUntil);
  if (from === null || to === null) return null;
  return { from, to: to + (typeof raw.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.to) ? dayMs : 0) };
}

/** Stored checks are point-in-time evidence. Policy or authorization changes
 * invalidate them; the live history calculation below remains separate. */
export function readWindowCheckpointMetadata(value: unknown, sourceRevision: number, authorizationId: string, authorizationRevision: number) {
  const stored = record(value);
  if (stored.version !== 1) return null;
  const window = (value: unknown) => {
    const item = record(value);
    return typeof item.taskId === "string" && typeof item.finishedAt === "string" && typeof item.from === "string" && typeof item.toExclusive === "string"
      ? { taskId: item.taskId, finishedAt: item.finishedAt, from: item.from, toExclusive: item.toExclusive } : null;
  };
  const history = record(stored.history), target = record(history.target);
  const gaps = Array.isArray(history.gaps) ? history.gaps.slice(0, 100).map(record).filter(gap => typeof gap.from === "string" && typeof gap.toExclusive === "string").map(gap => ({ from: gap.from as string, toExclusive: gap.toExclusive as string })) : [];
  const current = stored.sourceRevision === sourceRevision && stored.authorizationId === authorizationId && stored.authorizationRevision === authorizationRevision;
  return { checkedAt: typeof stored.checkedAt === "string" ? stored.checkedAt : null, current,
    basis: "CURRENT_SOURCE_AND_AUTHORIZATION_REVISION", intervalConvention: "FROM_INCLUSIVE_TO_EXCLUSIVE",
    lastTransportWindow: current ? window(stored.lastTransportWindow) : null, lastCompleteWindow: current ? window(stored.lastCompleteWindow) : null,
    history: { applicable: history.applicable === true, complete: current && history.complete === true, percent: current && typeof history.percent === "number" ? history.percent : null,
      target: typeof target.from === "string" && typeof target.toExclusive === "string" ? { from: target.from, toExclusive: target.toExclusive } : null,
      gapCount: current && typeof history.gapCount === "number" ? history.gapCount : null, gaps: current ? gaps : [], gapsTruncated: history.gapsTruncated === true },
    evidenceTruncated: stored.evidenceTruncated === true, schedulingSeparated: false, freshnessBasis: "CHECKED_AT_ONLY" };
}

/** Shared ERP/MCP evidence. Covers the registered domain catalogue only; it is
 * never presented as discovery of every Amazon operation or every official field. */
export async function readSyncCoverage(scope: SyncScope, params: URLSearchParams, actor: string, sourceFence?: string[]) {
  const now = new Date(), access = await amazonDataAccess(scope, actor);
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { AND: [scope, sourceAccessWhere(access), ...(sourceFence ? [{ id: { in: sourceFence } }] : []), ...(params.get("sellerAccountId") ? [{ sellerAccountId: params.get("sellerAccountId")! }] : []), ...(params.get("marketplaceId") ? [{ marketplaceId: params.get("marketplaceId")! }] : [])] },
    include: { authorization: { select: { id: true, revision: true, status: true, amazonSellerId: true, identityVerifiedAt: true } }, publishedRun: { select: { id: true, status: true, stage: true, finishedAt: true, executionVersion: true, paginationComplete: true } },
      runs: { where: { executionVersion: 2 }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, status: true, stage: true, processedCount: true, failedCount: true, pagesCompleted: true, paginationComplete: true, logs: { where: { stage: "REQUEST", statusCode: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { event: true, statusCode: true } } } },
      targets: { select: { schedule: { select: { enabled: true, nextRunAt: true, intervalMinutes: true } } } } }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("覆盖率来源超出当前 200 个容量；未计算不完整百分比。", 409);
  const history = await prisma.amazonSyncRun.findMany({ where: { ...scope, sourceId: { in: sources.map(s => s.id) }, executionVersion: 2, status: "SUCCEEDED", finishedAt: { not: null }, stage: { not: "PURGED" } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }], select: { sourceId: true, resource: true, stage: true, paginationComplete: true, frozenScope: true, summary: true }, take: 10001 });
  const evidenceTruncated = history.length > 10000;
  const items = await Promise.all(sources.map(async source => {
    const coverage = record(source.coverage), latestTask = source.runs[0] ?? null;
    const attributed = !requiresReportRowAttribution(source.resource) || hasCompleteReportAttributionProof(coverage.rowAttribution);
    const readable = !requiresReportRowAttribution(source.resource) || hasReadableReportAttributionProof(coverage.rowAttribution);
    const published = readable && source.activeRunId === source.publishedRun?.id && source.publishedRun?.status === "SUCCEEDED" && !!source.publishedRun.finishedAt && source.publishedRun.stage !== "PURGED" && source.publishedRun.executionVersion === 2;
    const target = historicalTarget(source, now);
    const sourceHistory = history.filter(run => run.sourceId === source.id && matchesAuthorizationHistory(source, run.frozenScope));
    const windows = sourceHistory.flatMap(run => { const w = successfulWindow(run); return w ? [w] : []; });
    // A retention adjustment must not erase a previously recorded historical gap
    // simply by moving the policy start forward.
    const retentionGaps = [coverage, ...sourceHistory.map(run => record(record(run.summary).coverage))].flatMap(value => Array.isArray(value.retentionGaps) ? value.retentionGaps.map(record) : value.retentionGap ? [record(value.retentionGap)] : []);
    if (target) for (const gap of retentionGaps) { const from = time(gap.from); if (from !== null) target.from = Math.min(target.from, from); }
    const measured = target && attributed && !evidenceTruncated ? intervalCoverage(target, windows) : null;
    let brand: { total: number; completed: number; complete: boolean } | null = null;
    if (source.resource === "brand_analytics") {
      try { const collection = await readBrandCollection(prisma, scope, source); if (collection) brand = { total: collection.total, completed: collection.completed, complete: collection.complete }; } catch { /* No complete evidence means unknown, never 100%. */ }
    }
    const snapshotComplete = published && attributed && (coverage.paginationComplete === true || coverage.complete === true || source.publishedRun?.paginationComplete === true) && coverage.historicalComplete !== false;
    const historicalComplete = brand ? brand.complete : measured?.complete ?? false;
    const fresh = !!source.lastSuccessAt && now.getTime() - source.lastSuccessAt.getTime() <= source.freshnessMinutes * 60_000;
    const dataComplete = target || brand ? historicalComplete : snapshotComplete;
    const status = !source.enabled ? "PAUSED" : source.authorization.status !== "CONFIGURED" ? "AUTHORIZATION_BLOCKED" : !attributed ? "ATTRIBUTION_PENDING" : latestTask && ["FAILED", "BLOCKED", "PARTIAL_SUCCESS"].includes(latestTask.status) ? latestTask.status : latestTask && ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT"].includes(latestTask.status) ? "IN_PROGRESS" : dataComplete ? fresh ? "CURRENT" : "STALE" : published ? "PARTIAL" : "NOT_PUBLISHED";
    const lastRequest = latestTask?.logs[0];
    const capabilityStatus = lastRequest?.statusCode === 403 && latestTask && ["FAILED", "BLOCKED"].includes(latestTask.status) ? "NO_PERMISSION_OR_INELIGIBLE" : latestTask?.status === "PARTIAL_SUCCESS" ? "PARTIAL_SUCCESS" : published ? "PUBLISHED" : latestTask && latestTask.pagesCompleted > 0 ? "COLLECTED_NOT_PUBLISHED" : "REGISTERED_NOT_VERIFIED";
    return { sourceId: source.id, capabilityStatus, resource: source.resource, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, status, published, visibleRows: published ? source.rowCount : 0, latestTask,
      windowCheckpoints: readWindowCheckpointMetadata(coverage.windowCheckpoints, source.revision, source.authorizationId, source.authorization.revision),
      lastSuccessAt: source.lastSuccessAt, fresh, snapshotComplete: target || brand ? null : snapshotComplete,
      completionBasis: target || brand ? "HISTORICAL_WINDOWS" : "CONFIGURED_SNAPSHOT_SCOPE", accountUniverseComplete: coverage.accountUniverseComplete === true,
      history: { applicable: !!target || source.resource === "brand_analytics", complete: historicalComplete, percent: evidenceTruncated ? null : brand ? brand.total ? Math.floor(brand.completed / brand.total * 10000) / 100 : null : measured?.percent ?? null,
        target: target ? { from: new Date(target.from).toISOString(), toExclusive: new Date(target.to).toISOString() } : null,
        coveredMilliseconds: measured?.coveredMs ?? null, expectedMilliseconds: measured?.expectedMs ?? null, gapCount: measured?.gaps.length ?? null, gaps: measured?.gaps.slice(0, 100) ?? [], gapsTruncated: (measured?.gaps.length ?? 0) > 100, brand },
      schedule: source.targets.map(t => t.schedule), complete: dataComplete && fresh && status === "CURRENT" };
  }));
  const pairs = new Set(sources.map(s => `${s.sellerAccountId}:${s.marketplaceId}`));
  const domains = syncDomains.map(domain => {
    const rows = items.filter(item => item.resource === domain.id);
    const expected = ["finance", "notifications"].includes(domain.id) ? new Set(sources.map(s => s.authorizationId)).size : pairs.size;
    const restricted = false;
    const complete = !restricted && expected > 0 && rows.length >= expected && rows.every(row => row.complete);
    return { resource: domain.id, name: domain.name, adapterImplemented: domain.implemented, expectedSources: restricted ? null : expected, configuredSources: rows.length, completedSources: rows.filter(row => row.complete).length, complete,
      status: restricted ? "ACCESS_RESTRICTED" : domain.id === "order_items" ? "DERIVED_FROM_ORDERS_DETAILS" : !domain.implemented ? "ADAPTER_NOT_IMPLEMENTED" : rows.length < expected ? "MISSING_SOURCE" : complete ? "COMPLETE" : "INCOMPLETE" };
  });
  return { observedAt: now.toISOString(), schemaRegistry: registeredSpApiSchemas(), universe: "REGISTERED_SP_API_DOMAINS_ONLY", allOfficialApisComplete: false, evidenceTruncated, sources: items, domains,
    summary: { registeredDomains: domains.length, completedDomains: domains.filter(d => d.complete).length, domainCoveragePercent: domains.length ? Math.floor(domains.filter(d => d.complete).length / domains.length * 10000) / 100 : null, complete: domains.length > 0 && domains.every(d => d.complete), fieldCoveragePercent: null, officialSchemaCoverageVerified: false } };
}
