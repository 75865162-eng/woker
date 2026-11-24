import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import type { SyncScope } from "./policy";

/**
 * 商品多周期销量宽表（Wimoor ProductAnalysisController 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数、与赛狐隔离）：
 * - 数据源仅 AmazonSalesTrafficProductSnapshot（SP-API Sales & Traffic 商品日真实事实），不接赛狐。
 * - 按站点 + 粒度(childAsin/sellerSku) 归组；在近 90 天商品日行上计算 7/15/30/90 天滚动窗口。
 * - 每窗口指标：unitsOrdered、sessions、pageViews 求和；CVR = unitsOrdered / sessions（sessions 为 0 或缺失为 null）。
 * - 金额(orderedProductSales) 按币种分列，不在本宽表折算、不混算。
 * - 商品日行缺失某指标时为 null（不补零）；窗口内无数据行则该指标为 null。
 * - BuyBox 占比不在本模块计算（属 observation 单日口径，避免跨口径混算），由 BuyBox 历史页承载。
 */

export type ProductDayInput = {
  marketplaceId: string;
  identity: string;       // childAsin 或 sellerSku，取决于粒度
  businessDate: string;   // YYYY-MM-DD
  units: number | null;
  sessions: number | null;
  pageViews: number | null;
};

export type PeriodMetrics = {
  units: number | null;
  sessions: number | null;
  pageViews: number | null;
  cvr: string | null;
  daysWithData: number;
};

export type ProductPeriodRow = {
  marketplaceId: string;
  identity: string;
  d7: PeriodMetrics;
  d15: PeriodMetrics;
  d30: PeriodMetrics;
  d90: PeriodMetrics;
};

export const PRODUCT_PERIOD_WINDOWS = [7, 15, 30, 90] as const;
export type ProductPeriod = (typeof PRODUCT_PERIOD_WINDOWS)[number];

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function shiftDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

/** 纯函数：单个窗口的商品日行 → 窗口指标（缺失指标不补零，CVR 分母为 0 为 null）。 */
export function metricsForWindow(lines: ProductDayInput[], windowEnd: string, days: number): PeriodMetrics {
  const start = shiftDays(windowEnd, -(days - 1));
  const inWindow = lines.filter(l => l.businessDate >= start && l.businessDate <= windowEnd);
  const hasUnits = inWindow.some(l => l.units !== null);
  const hasSessions = inWindow.some(l => l.sessions !== null);
  const hasViews = inWindow.some(l => l.pageViews !== null);
  const units = hasUnits ? inWindow.reduce((n, l) => n + (l.units ?? 0), 0) : null;
  const sessions = hasSessions ? inWindow.reduce((n, l) => n + (l.sessions ?? 0), 0) : null;
  const pageViews = hasViews ? inWindow.reduce((n, l) => n + (l.pageViews ?? 0), 0) : null;
  const cvr = units !== null && sessions !== null && sessions > 0 ? fmt(units / sessions) : null;
  return { units, sessions, pageViews, cvr, daysWithData: new Set(inWindow.map(l => l.businessDate)).size };
}

/** 纯函数：商品日行 → 按站点+identity 的多周期宽表。 */
export function buildProductPeriodRows(lines: ProductDayInput[], windowEnd: string): ProductPeriodRow[] {
  const groups = new Map<string, ProductDayInput[]>();
  for (const l of lines) {
    const key = `${l.marketplaceId}\u0000${l.identity}`;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [marketplaceId, identity] = key.split("\u0000");
    const metrics = (days: number) => metricsForWindow(rows, windowEnd, days);
    return { marketplaceId, identity, d7: metrics(7), d15: metrics(15), d30: metrics(30), d90: metrics(90) };
  }).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId) || a.identity.localeCompare(b.identity));
}

export const PRODUCT_PERIOD_BASIS = [
  "商品多周期销量宽表口径（保守默认，迁移自 Wimoor ProductAnalysisController）：",
  "1) 数据源仅 AmazonSalesTrafficProductSnapshot（SP-API Sales & Traffic 商品日真实事实），不接赛狐。",
  "2) 按站点 + 粒度(childAsin/sellerSku) 归组，在近 90 天商品日行上算 7/15/30/90 天滚动窗口。",
  "3) 窗口指标 unitsOrdered/sessions/pageViews 求和；CVR = unitsOrdered/sessions，分母为 0 或缺失为 null。",
  "4) 商品日缺失某指标为 null，不补零；窗口无数据行该指标为 null。金额按币种分列，本宽表不折算不混算。",
  "5) BuyBox 占比属 observation 单日口径，不在本模块混算，由 BuyBox 历史页承载。",
].join("\n");

const ROW_CAP = 60000;

type Granularity = "CHILD" | "SKU";

/** 只读：近 90 天商品日事实 → 多周期销量宽表。 */
export async function readProductPeriodAnalytics(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: ProductPeriodRow[]; basis: string; granularity: Granularity; windowEnd: string; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "sales-traffic");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const granularity: Granularity = params.get("granularity") === "SKU" ? "SKU" : "CHILD";
  const identityFilter = params.get("identity")?.trim().slice(0, 200) ?? "";
  const marketplace = params.get("marketplaceId")?.trim().slice(0, 50) ?? "";
  const asOf = new Date();
  const windowEnd = isoDay(asOf);
  const windowStart = shiftDays(windowEnd, -89);

  const raw = await prisma.amazonSalesTrafficProductSnapshot.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      businessDate: { gte: windowStart, lte: windowEnd },
      granularity,
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(marketplace ? { marketplaceId: marketplace } : {}),
      ...(identityFilter ? (granularity === "SKU" ? { sellerSku: { contains: identityFilter } } : { childAsin: { contains: identityFilter } }) : {}),
    },
    orderBy: { businessDate: "desc" },
    take: ROW_CAP + 1,
    select: { marketplaceId: true, childAsin: true, sellerSku: true, businessDate: true, metrics: true },
  });

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
  };
  const lines: ProductDayInput[] = [];
  for (const r of raw) {
    const identity = granularity === "SKU" ? (r.sellerSku ?? "").trim() : (r.childAsin ?? "").trim();
    if (!identity) continue;
    const m = r.metrics as Record<string, unknown> | null;
    lines.push({
      marketplaceId: r.marketplaceId,
      identity,
      businessDate: r.businessDate,
      units: num(m?.unitsOrdered),
      sessions: num(m?.sessions),
      pageViews: num(m?.pageViews),
    });
    if (lines.length >= ROW_CAP) break;
  }
  return {
    rows: buildProductPeriodRows(lines, windowEnd),
    basis: PRODUCT_PERIOD_BASIS,
    granularity,
    windowEnd,
    asOf: asOf.toISOString(),
    truncated: raw.length > ROW_CAP,
  };
}
