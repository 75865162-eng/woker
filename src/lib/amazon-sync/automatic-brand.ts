import type { Prisma } from "@prisma/client";
import { brandReports, type BrandPeriod } from "./brand-reports";
import { brandWindowKey } from "./brand-collection";
import { digest } from "./approval-policy";
import { localDate, shiftDate } from "./date-range";
import { discoverProductObjects } from "./product-discovery";
import { parseObservationPolicy, type AnalyticsPolicy } from "./observation-policy";
import { SyncInputError, type SyncScope } from "./policy";

export function latestClosedBrandWindow(today: string, period: BrandPeriod) {
  const date = new Date(`${today}T00:00:00Z`), y = date.getUTCFullYear(), m = date.getUTCMonth();
  if (period === "DAY") return { from: shiftDate(today, -1), to: shiftDate(today, -1) };
  if (period === "WEEK") { const to = shiftDate(today, -date.getUTCDay() - 1); return { from: shiftDate(to, -6), to }; }
  const endMonth = period === "QUARTER" ? m - m % 3 : m;
  return { from: new Date(Date.UTC(y, endMonth - (period === "QUARTER" ? 3 : 1), 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, endMonth, 0)).toISOString().slice(0, 10) };
}

export function automaticBrandCandidates(configured: AnalyticsPolicy, asins: string[], now: Date): AnalyticsPolicy[] {
  const { automaticDiscovery: _automatic, ...base } = configured; void _automatic;
  const today = localDate(now, configured.marketplaceTimeZone), result: AnalyticsPolicy[] = [];
  for (const [kind, report] of Object.entries(brandReports)) for (const period of report.periods) {
    const batches = report.asinScoped ? Array.from({ length: Math.ceil(asins.length / 18) }, (_, index) => asins.slice(index * 18, (index + 1) * 18)) : [[]];
    for (const batch of batches) result.push({ ...base, reportKind: kind as AnalyticsPolicy["reportKind"], reportPeriod: period, ...latestClosedBrandWindow(today, period), asins: batch });
  }
  return result;
}

/** Probe every current report/period before older periods. Each round advances
 * one complete period per combination, never widening the configured start.
 * This is a request manifest, not evidence of Amazon retention or eligibility. */
export function* automaticBrandHistoryCandidates(configured: AnalyticsPolicy, asins: string[], now: Date): Generator<AnalyticsPolicy> {
  let round = automaticBrandCandidates(configured, asins, now);
  while (round.length) {
    round = round.filter(candidate => candidate.from >= configured.from);
    for (const candidate of round) yield candidate;
    round = round.map(candidate => ({ ...candidate, ...latestClosedBrandWindow(candidate.from, candidate.reportPeriod) }));
  }
}

export function assertAutomaticBrandTask(configured: AnalyticsPolicy, candidate: AnalyticsPolicy, now = new Date()) {
  const { automaticDiscovery, reportKind: _kind, reportPeriod: _period, from, to: _to, asins: _asins, ...fixed } = configured;
  const { reportKind: _selectedKind, reportPeriod: _selectedPeriod, from: selectedFrom, to: selectedTo, asins: _selectedAsins, ...selectedFixed } = candidate;
  void _kind; void _period; void _to; void _asins; void _selectedKind; void _selectedPeriod; void _selectedAsins;
  if (!automaticDiscovery || candidate.automaticDiscovery || candidate.collection || digest(fixed) !== digest(selectedFixed) || selectedFrom < from || selectedTo >= localDate(now, configured.marketplaceTimeZone)) throw new SyncInputError("品牌自动任务超出完整周期或来源预算。", 403);
}

/** A changing catalog can move previously attempted ASINs between batches.
 * Compare objects within each report window, not only the old batch key. Failed
 * objects still belong to their original task/checkpoint and are not recreated. */
export function nextUnattemptedAutomaticBrandPolicy(configured: AnalyticsPolicy, asins: string[], attempts: AnalyticsPolicy[], now: Date): AnalyticsPolicy | null {
  const byWindow = new Map<string, Set<string>>();
  for (const policy of attempts) {
    const key = brandWindowKey({ ...policy, asins: [] });
    const objects = byWindow.get(key) ?? new Set<string>();
    for (const asin of policy.asins.length ? policy.asins : ["*"]) objects.add(asin);
    byWindow.set(key, objects);
  }
  for (const candidate of automaticBrandHistoryCandidates(configured, asins, now)) {
    const objects = byWindow.get(brandWindowKey({ ...candidate, asins: [] }));
    if (!objects) return candidate;
    if (!candidate.asins.length) continue;
    const remaining = candidate.asins.filter(asin => !objects.has(asin));
    if (remaining.length) return { ...candidate, asins: remaining };
  }
  return null;
}

/** Resume the existing task manifest across current and historical closed
 * periods. Failed creates remain gaps bound to their original tasks. */
export async function nextAutomaticBrandPolicy(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, configured: AnalyticsPolicy, now = new Date()) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "brand_analytics" }, include: { authorization: true } });
  const catalog = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: "catalog", enabled: true }, select: { id: true } });
  let asins: string[] = [];
  if (catalog) {
    try {
      const manifest = await discoverProductObjects(tx, scope, source, { resource: "catalog_items", applicationId: configured.applicationId, asins: [], maxRows: 50000, maxRequests: 1000, requestsPerSecond: .2, discovery: { mode: "catalog_snapshot", sourceId: catalog.id, batchSize: 100, maxObjects: 1000 } });
      asins = manifest?.ids ?? [];
    } catch (error) { if (!(error instanceof SyncInputError && error.status === 409)) throw error; }
  }
  const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, sourceId, resource: "brand_analytics", executionVersion: 2, stage: { not: "PURGED" }, AND: [
    { frozenScope: { path: ["sourceRevision"], equals: source.revision } },
    { frozenScope: { path: ["authorizationId"], equals: source.authorizationId } },
    { frozenScope: { path: ["authorizationRevision"], equals: source.authorization.revision } },
  ] }, select: { frozenScope: true }, take: 4001 });
  if (runs.length > 4000) throw new SyncInputError("品牌自动任务证据超过容量，未重放历史任务。", 409);
  const attempts = runs.flatMap(run => { try { const p = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, "brand_analytics"); return p.resource === "brand_analytics" ? [p] : []; } catch { return []; } });
  // Failed and uncertain creates retain their task and checkpoint. They cannot
  // monopolize every other report kind/period or be silently recreated here.
  const next = nextUnattemptedAutomaticBrandPolicy(configured, asins, attempts, now);
  if (next) {
    assertAutomaticBrandTask(configured, next, now);
    return next;
  }
  throw new SyncInputError("品牌配置范围内完整周期已调度；等待原任务恢复或下一个闭合周期。", 409);
}
