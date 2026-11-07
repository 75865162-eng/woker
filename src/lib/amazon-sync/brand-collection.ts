import { brandReports, type BrandKind, type BrandPeriod } from "./brand-reports";
import { businessDate, shiftDate } from "./date-range";
import { SyncInputError } from "./policy";
import type { AnalyticsPolicy } from "./observation-policy";

export type BrandCollection = { from: string; to: string; asins: string[]; selections: Array<{ reportKind: BrandKind; reportPeriod: BrandPeriod }>; maxTasks: number };
export function parseBrandCollection(value: unknown): BrandCollection {
  const fail = (): never => { throw new SyncInputError("品牌回补范围无效；请核对日期、报告类型、周期与 ASIN。", 422); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const p = value as Record<string, unknown>, from = businessDate(p.from), to = businessDate(p.to);
  if (from > to || !Array.isArray(p.asins) || p.asins.length > 1000 || p.asins.some(v => typeof v !== "string" || !/^[A-Z0-9]{10}$/.test(v)) || new Set(p.asins).size !== p.asins.length) return fail();
  if (!Array.isArray(p.selections) || !p.selections.length || p.selections.length > 17 || !Number.isSafeInteger(p.maxTasks) || Number(p.maxTasks) < 1 || Number(p.maxTasks) > 2000) return fail();
  const selections = p.selections.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const { reportKind, reportPeriod } = value as Record<string, unknown>;
    if (typeof reportKind !== "string" || !Object.hasOwn(brandReports, reportKind)) return fail();
    const kind = reportKind as BrandKind;
    if (!(brandReports[kind].periods as readonly unknown[]).includes(reportPeriod) || brandReports[kind].asinScoped && !(p.asins as unknown[]).length) return fail();
    return { reportKind: kind, reportPeriod: reportPeriod as BrandPeriod };
  }).sort((a, b) => `${a.reportKind}:${a.reportPeriod}`.localeCompare(`${b.reportKind}:${b.reportPeriod}`));
  if (new Set(selections.map(s => `${s.reportKind}:${s.reportPeriod}`)).size !== selections.length) return fail();
  const result = { from, to, asins: (p.asins as string[]).slice().sort(), selections, maxTasks: Number(p.maxTasks) };
  brandCollectionWindows(result); // Fail before persisting an oversized or empty plan.
  return result;
}

function periodBounds(date: string, period: BrandPeriod): { from: string; to: string } {
  const d = new Date(date + "T00:00:00Z"), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (period === "DAY") return { from: date, to: date };
  if (period === "WEEK") { const from = shiftDate(date, -d.getUTCDay()); return { from, to: shiftDate(from, 6) }; }
  const first = period === "QUARTER" ? m - m % 3 : m;
  return { from: new Date(Date.UTC(y, first, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, first + (period === "QUARTER" ? 3 : 1), 0)).toISOString().slice(0, 10) };
}
export type BrandWindow = { reportKind: BrandKind; reportPeriod: BrandPeriod; from: string; to: string; asins: string[] };
/** Never rounds a requested range outward. Partial edge periods remain uncovered. */
export function brandCollectionWindows(collection: BrandCollection): BrandWindow[] {
  const windows: BrandWindow[] = [];
  for (const selection of collection.selections) {
    let bounds = periodBounds(collection.from, selection.reportPeriod);
    if (bounds.from < collection.from) bounds = periodBounds(shiftDate(bounds.to, 1), selection.reportPeriod);
    let count = 0;
    while (bounds.to <= collection.to) {
      const batches: string[][] = [];
      if (brandReports[selection.reportKind].asinScoped) for (let i = 0; i < collection.asins.length; i += 18) batches.push(collection.asins.slice(i, i + 18));
      else batches.push([]);
      for (const asins of batches) {
        windows.push({ ...selection, ...bounds, asins });
        if (windows.length > collection.maxTasks) throw new SyncInputError(`品牌回补超过批准的 ${collection.maxTasks} 份报告预算；请拆分日期范围。`, 422);
      }
      count++;
      bounds = periodBounds(shiftDate(bounds.to, 1), selection.reportPeriod);
    }
    if (!count) throw new SyncInputError("所选日期内没有该报告的完整周期；请调整起止日期。", 422);
  }
  return windows;
}
export function brandWindowKey(p: BrandWindow): string { return JSON.stringify([p.reportKind, p.reportPeriod, p.from, p.to, [...p.asins].sort()]); }
export function brandTaskPolicy(configured: AnalyticsPolicy, window: BrandWindow): AnalyticsPolicy {
  const { collection: _collection, ...base } = configured; void _collection;
  const { reportKind, reportPeriod, from, to, asins } = window;
  return { ...base, reportKind, reportPeriod, from, to, asins };
}
export function assertBrandTaskPolicy(configured: AnalyticsPolicy, candidate: AnalyticsPolicy): void {
  if (!configured.collection || candidate.collection || !brandCollectionWindows(configured.collection).some(w => brandWindowKey(w) === brandWindowKey(candidate) && ["applicationId", "maxRequests", "maxRows", "requestsPerSecond", "marketplaceTimeZone", "brandEligibilityAttested"].every(k => configured[k as keyof AnalyticsPolicy] === candidate[k as keyof AnalyticsPolicy]))) throw new SyncInputError("品牌任务超出已批准的报告/周期/ASIN 或预算范围。", 403);
}
