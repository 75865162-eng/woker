import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import type { SyncScope } from "./policy";

/**
 * 跨 SKU 补货信号 / 覆盖周数宽表（Wimoor AmzInventoryPlanningController 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数、与赛狐隔离）：
 * - 数据源仅 AmazonInventorySnapshot（FBA 最新快照）+ AmazonSalesTrafficProductSnapshot（商品日销量），不接赛狐。
 * - 每个站点+SKU 取最新库存快照，可售/在途按原值求和；近 30/90 天商品日销量按 SKU 归组。
 * - 日均销量 = 近30天 unitsOrdered / 近30天有数据天数（按有数据的天数算，缺日不补零）；无销量信号时日均 null。
 * - daysOfCover = 可售 / 日均销量（日均缺失或 0 时 null）；weeksOfCover = daysOfCover / 7。
 * - 信号（仅提示非结论）：STOCKOUT_RISK=可售0且在途0；SLOW_MOVING=可售>0且近30天销量0；NO_SALE_90D=近90天销量0；NORMAL=其余。
 * - Wimoor 原生 recommended_action/no_sale_last_6_months 属 GET_FBA_INVENTORY_PLANNING_DATA 报告原生字段，
 *   我方未采集，故不伪造；本模块只产出可由原生数据推导的覆盖周数与保守信号。
 */

export type SkuInventoryInput = {
  marketplaceId: string; sellerSku: string; asin: string;
  fulfillable: number; inbound: number; reserved: number;
};

export type ReplenishmentSignalRow = {
  marketplaceId: string; sellerSku: string; asin: string;
  fulfillable: number; inbound: number; reserved: number;
  units30: number | null; units90: number | null; daysWithSales30: number;
  dailyDemand30: string | null;
  daysOfCover: string | null; weeksOfCover: string | null;
  signal: "STOCKOUT_RISK" | "SLOW_MOVING" | "NO_SALE_90D" | "NORMAL";
};

export type ReplenishmentSignalSummary = {
  skuCount: number; stockoutRisk: number; slowMoving: number; noSale90d: number; normal: number;
};

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const key = (site: string, sku: string) => `${site}\u0000${sku}`;

/** 纯函数：SKU 最新库存 + 近30/90销量 → 覆盖周数与保守信号宽表。 */
export function buildReplenishmentSignals(
  inv: SkuInventoryInput[],
  sales: Map<string, { units30: number | null; units90: number | null; daysWithSales30: number }>,
): ReplenishmentSignalRow[] {
  return inv.map(l => {
    const s = sales.get(key(l.marketplaceId, l.sellerSku)) ?? { units30: null, units90: null, daysWithSales30: 0 };
    const dailyDemand = s.units30 !== null && s.daysWithSales30 > 0 ? s.units30 / s.daysWithSales30 : null;
    const daysOfCover = dailyDemand !== null && dailyDemand > 0 ? l.fulfillable / dailyDemand : null;
    const weeksOfCover = daysOfCover !== null ? daysOfCover / 7 : null;
    let signal: ReplenishmentSignalRow["signal"] = "NORMAL";
    if (l.fulfillable === 0 && l.inbound === 0) signal = "STOCKOUT_RISK";
    else if (l.fulfillable > 0 && s.units30 === 0 && s.units90 !== null) signal = "SLOW_MOVING";
    else if (s.units90 === 0) signal = "NO_SALE_90D";
    return {
      marketplaceId: l.marketplaceId, sellerSku: l.sellerSku, asin: l.asin,
      fulfillable: l.fulfillable, inbound: l.inbound, reserved: l.reserved,
      units30: s.units30, units90: s.units90, daysWithSales30: s.daysWithSales30,
      dailyDemand30: dailyDemand !== null ? fmt(dailyDemand) : null,
      daysOfCover: daysOfCover !== null ? fmt(daysOfCover) : null,
      weeksOfCover: weeksOfCover !== null ? fmt(weeksOfCover) : null,
      signal,
    };
  }).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId) || a.sellerSku.localeCompare(b.sellerSku));
}

/** 纯函数：信号行 → 汇总计数。 */
export function buildReplenishmentSummary(rows: ReplenishmentSignalRow[]): ReplenishmentSignalSummary {
  const count = (s: ReplenishmentSignalRow["signal"]) => rows.filter(r => r.signal === s).length;
  return {
    skuCount: rows.length,
    stockoutRisk: count("STOCKOUT_RISK"), slowMoving: count("SLOW_MOVING"),
    noSale90d: count("NO_SALE_90D"), normal: count("NORMAL"),
  };
}

export const REPLENISHMENT_SIGNALS_BASIS = [
  "跨 SKU 补货信号 / 覆盖周数口径（保守默认，迁移自 Wimoor AmzInventoryPlanningController）：",
  "1) 数据源仅 AmazonInventorySnapshot（FBA 最新快照）+ AmazonSalesTrafficProductSnapshot（商品日销量），不接赛狐。",
  "2) 每站点+SKU 取最新库存快照；可售/在途/预留原值求和，不推断。",
  "3) 日均销量 = 近30天 unitsOrdered / 近30天有数据天数（缺日不补零）；daysOfCover = 可售/日均；weeksOfCover = daysOfCover/7；分母缺失或 0 为 null。",
  "4) 信号：STOCKOUT_RISK=可售0且在途0；SLOW_MOVING=可售>0且近30天销量0；NO_SALE_90D=近90天销量0；NORMAL=其余。仅提示非结论。",
  "5) Wimoor 原生 recommended_action/no_sale_last_6_months 属补货建议报告字段，我方未采集，不伪造。",
].join("\n");

const INV_CAP = 12000;
const SALES_CAP = 60000;

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function shiftDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

/** 只读：最新 FBA 库存快照 + 近90天商品日销量 → 补货信号宽表。 */
export async function readReplenishmentSignals(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: ReplenishmentSignalRow[]; summary: ReplenishmentSignalSummary; basis: string;
  windowEnd: string; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "inventory");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const skuFilter = params.get("sku")?.trim().slice(0, 200) ?? "";
  const marketplace = params.get("marketplaceId")?.trim().slice(0, 50) ?? "";
  const asOf = new Date();
  const windowEnd = isoDay(asOf);
  const start30 = shiftDays(windowEnd, -29);
  const start90 = shiftDays(windowEnd, -89);

  const rawInv = await prisma.amazonInventorySnapshot.findMany({
    where: {
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(skuFilter ? { sellerSku: { contains: skuFilter } } : {}),
      ...(marketplace ? { marketplaceId: marketplace } : {}),
    },
    orderBy: { capturedAt: "desc" },
    take: INV_CAP * 2 + 1,
    select: {
      sellerSku: true, asin: true, marketplaceId: true,
      fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true,
      inboundReceivingQuantity: true, reservedQuantity: true,
    },
  });
  const seen = new Set<string>();
  const inv: SkuInventoryInput[] = [];
  for (const r of rawInv) {
    const sku = (r.sellerSku ?? "").trim();
    if (!sku) continue;
    const k = key(r.marketplaceId, sku);
    if (seen.has(k)) continue;
    seen.add(k);
    inv.push({
      marketplaceId: r.marketplaceId, sellerSku: sku, asin: r.asin ?? "",
      fulfillable: r.fulfillableQuantity,
      inbound: r.inboundWorkingQuantity + r.inboundShippedQuantity + r.inboundReceivingQuantity,
      reserved: r.reservedQuantity,
    });
    if (inv.length >= INV_CAP) break;
  }

  const salesRaw = await prisma.amazonSalesTrafficProductSnapshot.findMany({
    where: {
      organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      granularity: "SKU",
      businessDate: { gte: start90, lte: windowEnd },
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
      ...(marketplace ? { marketplaceId: marketplace } : {}),
    },
    orderBy: { businessDate: "desc" },
    take: SALES_CAP + 1,
    select: { marketplaceId: true, sellerSku: true, businessDate: true, metrics: true },
  });
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
  };
  const sales = new Map<string, { units30: number | null; units90: number | null; daysWithSales30: number; days30: Set<string> }>();
  let hasUniverse30 = false;
  let hasUniverse90 = false;
  for (const r of salesRaw) {
    const sku = (r.sellerSku ?? "").trim();
    if (!sku) continue;
    const k = key(r.marketplaceId, sku);
    let a = sales.get(k);
    if (!a) { a = { units30: 0, units90: 0, daysWithSales30: 0, days30: new Set() }; sales.set(k, a); }
    if (r.businessDate >= start90) { hasUniverse90 = true; const u = num((r.metrics as Record<string, unknown> | null)?.unitsOrdered); if (u !== null) a.units90 = (a.units90 ?? 0) + u; }
    if (r.businessDate >= start30) { hasUniverse30 = true; const u = num((r.metrics as Record<string, unknown> | null)?.unitsOrdered); if (u !== null) { a.units30 = (a.units30 ?? 0) + u; a.days30.add(r.businessDate); } }
  }
  const normalized = new Map<string, { units30: number | null; units90: number | null; daysWithSales30: number }>();
  for (const [k, a] of sales) {
    normalized.set(k, {
      units30: hasUniverse30 ? (a.units30 ?? 0) : null,
      units90: hasUniverse90 ? (a.units90 ?? 0) : null,
      daysWithSales30: a.days30.size,
    });
  }
  const rows = buildReplenishmentSignals(inv, normalized);
  return {
    rows,
    summary: buildReplenishmentSummary(rows),
    basis: REPLENISHMENT_SIGNALS_BASIS,
    windowEnd,
    asOf: asOf.toISOString(),
    truncated: rawInv.length > INV_CAP * 2 || salesRaw.length > SALES_CAP,
  };
}
