/**
 * 周/月订单销售汇总（Wimoor 对标 §3 P3）——基于已发布订单头，按 day/week/month 聚合。
 *
 * 口径（保守、不造数）：
 * - 订单数 = distinct amazonOrderId（绝不拿订单项数冒充订单数）。
 * - 销售额 = grandTotalOriginal 按 currencyCode 分列求和（字符串保真，不跨币种相加）。
 * - 销量 = 订单项 quantityOrdered 求和；订单项数 = order item 行数（与订单数分开列示）。
 * - 按订单 createdTime 的业务日期（UTC）归入周期；缺日不补零。
 * - 权限/店铺范围复用 orderReadWhere，不越权。
 */
import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import { orderReadWhere } from "./orders-query";
import { SyncInputError, type SyncScope } from "./policy";
import { isoWeekOf, shiftDays } from "./sales-query";

export type OrderPeriodBucket = "day" | "week" | "month";
export type OrderAmount = { currency: string; amount: string };
export type OrderPeriodAgg = {
  period: string; periodStart: string; periodEnd: string;
  orders: number; orderItems: number; units: string | null;
  sales: OrderAmount[];
};
export type OrderPeriodSummary = {
  bucket: OrderPeriodBucket;
  periods: OrderPeriodAgg[];
  totals: OrderPeriodAgg;
  truncated: boolean; asOf: string;
};

export type OrderAggLine = {
  amazonOrderId: string; businessDate: string;
  grandTotalOriginal: string | null; currencyCode: string | null;
  itemCount: number; units: number;
};

const ORDER_AGG_CAP = 30000;
const fmt = (n: number): string => { const r = Math.round(n * 1_000_000) / 1_000_000; return Object.is(r, -0) ? "0" : String(r); };
const dec = (v: string | null): number | null => {
  if (!v) return null; const s = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};

/** 纯函数：订单行按周期分段聚合。订单数 distinct；金额按币种分列；不跨币种相加。 */
export function aggregateOrderPeriods(
  lines: OrderAggLine[],
  periodOf: (date: string) => { key: string; start: string; end: string },
): OrderPeriodAgg[] {
  const groups = new Map<string, {
    start: string; end: string; orderIds: Set<string>; items: number;
    units: number | null; sales: Map<string, number>;
  }>();
  for (const line of lines) {
    const { key, start, end } = periodOf(line.businessDate);
    let g = groups.get(key);
    if (!g) { g = { start, end, orderIds: new Set(), items: 0, units: 0, sales: new Map() }; groups.set(key, g); }
    g.orderIds.add(line.amazonOrderId);
    g.items += line.itemCount;
    if (!Number.isFinite(line.units)) g.units = null;
    else if (g.units !== null) g.units += line.units;
    const amount = dec(line.grandTotalOriginal);
    if (amount !== null && line.currencyCode) {
      const c = line.currencyCode.trim();
      if (c) g.sales.set(c, (g.sales.get(c) ?? 0) + amount);
    }
  }
  const toAgg = (key: string, g: { start: string; end: string; orderIds: Set<string>; items: number; units: number | null; sales: Map<string, number> }): OrderPeriodAgg => ({
    period: key, periodStart: g.start, periodEnd: g.end,
    orders: g.orderIds.size, orderItems: g.items,
    units: g.units === null ? null : fmt(g.units),
    sales: [...g.sales.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
  });
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, g]) => toAgg(key, g));
}

/** 纯函数：全期合计（同样 distinct 订单 + 分币种金额）。 */
export function summarizeOrderPeriods(lines: OrderAggLine[]): OrderPeriodAgg {
  return aggregateOrderPeriods(lines, () => ({ key: "all", start: "", end: "" }))[0] ?? {
    period: "all", periodStart: "", periodEnd: "", orders: 0, orderItems: 0, units: null, sales: [],
  };
}

export const ORDER_PERIOD_BASIS = [
  "周/月订单汇总口径（保守默认）：",
  "1) 订单数=distinct amazonOrderId（不把订单项数冒充订单数）；订单项数、销量分列。",
  "2) 销售额=订单 grandTotalOriginal 按币种分列求和（字符串保真，不跨币种相加）。",
  "3) 周期按订单 createdTime 的 UTC 日期归入 day/week/month（ISO 周）；站点本地时区差异待确认。",
  "4) 缺日不补零；仅统计当前权限可见、已同步的订单（订单头为逐页提交的非 PII 事实）。",
].join("\n");

/** 只读：全量拉订单头（含 item 计数）→ 应用层周期聚合。权限/范围复用 orderReadWhere。 */
export async function readOrderPeriods(scope: SyncScope, p: URLSearchParams, actor?: string): Promise<OrderPeriodSummary & { basis: string }> {
  p = new URLSearchParams(p);
  const bucketParam = p.get("bucket");
  if (bucketParam && !["day", "week", "month"].includes(bucketParam)) throw new SyncInputError("聚合粒度无效。");
  const bucket: OrderPeriodBucket = bucketParam === "week" ? "week" : bucketParam === "month" ? "month" : "day";

  const access = await amazonAccountReadAccess(scope, actor, p, prisma, "orders");
  const where = orderReadWhere(scope, p, access);
  // 有界分页拉取订单头；items 只取数量用于计数/销量（不做 PII 展开）。
  const lines: OrderAggLine[] = [];
  const pageSize = 1000;
  for (let page = 1; lines.length < ORDER_AGG_CAP; page++) {
    const rows = await prisma.amazonOrderRecord.findMany({
      where,
      orderBy: [{ createdTime: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: {
        amazonOrderId: true, createdTime: true, grandTotalOriginal: true, currencyCode: true,
        items: { select: { quantityOrdered: true } },
      },
    });
    for (const r of rows) {
      lines.push({
        amazonOrderId: r.amazonOrderId,
        businessDate: r.createdTime.toISOString().slice(0, 10),
        grandTotalOriginal: r.grandTotalOriginal,
        currencyCode: r.currencyCode,
        itemCount: r.items.length,
        units: r.items.reduce((n, it) => n + (Number.isFinite(it.quantityOrdered) ? it.quantityOrdered : 0), 0),
      });
    }
    if (rows.length < pageSize) break;
  }
  const truncated = lines.length >= ORDER_AGG_CAP;
  const periodOf = bucket === "week"
    ? (d: string) => { const w = isoWeekOf(d); return { key: `${w.year}-W${String(w.week).padStart(2, "0")}`, start: w.monday, end: shiftDays(w.monday, 6) }; }
    : bucket === "month"
      ? (d: string) => { const key = d.slice(0, 7); const [y, m] = key.split("-").map(Number); return { key, start: d.slice(0, 8) + "01", end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; }
      : (d: string) => ({ key: d, start: d, end: d });
  return {
    bucket,
    periods: aggregateOrderPeriods(lines, periodOf),
    totals: summarizeOrderPeriods(lines),
    truncated,
    asOf: new Date().toISOString(),
    basis: ORDER_PERIOD_BASIS,
  };
}
