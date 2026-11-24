import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import type { SyncScope } from "./policy";

/**
 * BuyBox 占比 + 流量趋势周/月上卷（Wimoor AmzProductPageviewsController 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数、与赛狐隔离）：
 * - 数据源仅 AmazonDomainObservation(kind=BUY_BOX_DAY)，即 SP-API 单日 ASIN 流量观察事实，不接赛狐。
 * - 取最新已发布 BUY_BOX_DAY 观察行（每 asin+businessDate 一条，重复版本取最新 capturedAt），
 *   facts 含 businessDate / asin / buyBoxPercentage(0-100) / sessions / pageViews。
 * - 上卷到自然周(ISO)/自然月：buyBoxPercentage 取区间均值（不跨区间补零），sessions/pageViews 求和；
 *   覆盖天数=该区间有观察的不同 businessDate 数。
 * - 缺失指标为 null（不补零）；占比为 0-100 百分数原样，不折算为小数、不改口径。
 * - 与商品多周期宽表互补：本模块含 BuyBox 占比，按自然周/月上卷；滚动 7/15/30/90 天窗口见 product-period-analytics。
 */

export type BuyBoxDayInput = {
  asin: string; businessDate: string;
  buyBoxPercentage: number | null; sessions: number | null; pageViews: number | null;
};

export type TrendBucket = "week" | "month";
export type TrendRow = {
  asin: string; periodKey: string; periodStart: string; periodEnd: string;
  avgBuyBoxPercentage: string | null; sessions: number | null; pageViews: number | null; daysWithData: number;
};

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function isoWeekOf(dateStr: string): { key: string; start: string; end: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  const monday = d;
  const year = monday.getUTCFullYear();
  const week = Math.ceil((((monday.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
  const end = new Date(monday); end.setUTCDate(end.getUTCDate() + 6);
  return { key: `${year}-W${String(week).padStart(2, "0")}`, start: monday.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function monthOf(dateStr: string): { key: string; start: string; end: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { key: `${year}-${String(month).padStart(2, "0")}`, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
const periodOf = (dateStr: string, bucket: TrendBucket) => bucket === "week" ? isoWeekOf(dateStr) : monthOf(dateStr);

/** 纯函数：BuyBox 日事实 → ASIN × 自然周/月上卷。 */
export function buildBuyBoxTrend(lines: BuyBoxDayInput[], bucket: TrendBucket): TrendRow[] {
  const groups = new Map<string, { asin: string; periodKey: string; periodStart: string; periodEnd: string; pct: number[]; sessions: number[]; views: number[]; dates: Set<string> }>();
  for (const l of lines) {
    const p = periodOf(l.businessDate, bucket);
    const key = `${l.asin}\u0000${p.key}`;
    let g = groups.get(key);
    if (!g) { g = { asin: l.asin, periodKey: p.key, periodStart: p.start, periodEnd: p.end, pct: [], sessions: [], views: [], dates: new Set() }; groups.set(key, g); }
    if (l.buyBoxPercentage !== null) g.pct.push(l.buyBoxPercentage);
    if (l.sessions !== null) g.sessions.push(l.sessions);
    if (l.pageViews !== null) g.views.push(l.pageViews);
    g.dates.add(l.businessDate);
  }
  return [...groups.values()].map(g => ({
    asin: g.asin, periodKey: g.periodKey, periodStart: g.periodStart, periodEnd: g.periodEnd,
    avgBuyBoxPercentage: g.pct.length ? fmt(g.pct.reduce((n, v) => n + v, 0) / g.pct.length) : null,
    sessions: g.sessions.length ? g.sessions.reduce((n, v) => n + v, 0) : null,
    pageViews: g.views.length ? g.views.reduce((n, v) => n + v, 0) : null,
    daysWithData: g.dates.size,
  })).sort((a, b) => a.asin.localeCompare(b.asin) || a.periodStart.localeCompare(b.periodStart));
}

export const BUYBOX_TREND_BASIS = [
  "BuyBox 占比 + 流量趋势周/月上卷口径（保守默认，迁移自 Wimoor AmzProductPageviewsController）：",
  "1) 数据源仅 AmazonDomainObservation(kind=BUY_BOX_DAY)，SP-API 单日 ASIN 流量观察，不接赛狐。",
  "2) 每 asin+businessDate 取最新 capturedAt 一条观察，重复版本不叠加。",
  "3) 上卷自然周(ISO)/自然月：buyBoxPercentage 取区间均值，sessions/pageViews 求和，覆盖天数=不同 businessDate 数；缺失为 null 不补零。",
  "4) buyBoxPercentage 为 0-100 百分数原样，不折算小数、不改口径；与滚动窗口宽表(product-period-analytics)互补。",
].join("\n");

const ROW_CAP = 30000;

function validDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** 只读：BuyBox 日观察 → ASIN × 周/月上卷趋势。 */
export async function readBuyBoxTrend(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: TrendRow[]; basis: string; bucket: TrendBucket; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "buy_box_history");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const bucket: TrendBucket = params.get("bucket") === "month" ? "month" : "week";
  const asinFilter = params.get("asin")?.trim().slice(0, 50) ?? "";
  const from = params.get("from")?.trim().slice(0, 10) ?? "";
  const to = params.get("to")?.trim().slice(0, 10) ?? "";

  // AmazonDomainObservation 无 sellerAccountId 列，按 seller 账号经数据源间接过滤。
  const sourceIds = sellerIds.length
    ? (await prisma.amazonSyncDataSource.findMany({
        where: { ...scope, sellerAccountId: { in: sellerIds } }, select: { id: true },
      })).map(s => s.id)
    : [];

  const raw = await prisma.amazonDomainObservation.findMany({
    where: {
      ...scope, kind: "BUY_BOX_DAY",
      ...(sourceIds.length ? { sourceId: { in: sourceIds } } : {}),
      ...(asinFilter ? { asin: asinFilter } : {}),
    },
    orderBy: { capturedAt: "desc" },
    take: ROW_CAP * 2 + 1,
    select: { asin: true, sellerSku: true, facts: true, capturedAt: true },
  });

  const seen = new Set<string>();
  const lines: BuyBoxDayInput[] = [];
  for (const r of raw) {
    if (!r.asin) continue;
    const f = r.facts as Record<string, unknown> | null;
    const date = f?.businessDate;
    if (!validDay(date)) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    const key = `${r.asin}\u0000${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      asin: r.asin, businessDate: date,
      buyBoxPercentage: num(f?.buyBoxPercentage),
      sessions: num(f?.sessions),
      pageViews: num(f?.pageViews),
    });
    if (lines.length >= ROW_CAP) break;
  }
  return {
    rows: buildBuyBoxTrend(lines, bucket),
    basis: BUYBOX_TREND_BASIS,
    bucket,
    asOf: new Date().toISOString(),
    truncated: raw.length > ROW_CAP * 2,
  };
}
