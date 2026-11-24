import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import { sellerAccessWhere } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

/**
 * 退货率 + 质量归因报表（Wimoor OrdersReturnController 对标，迁移到亚马逊模块）。
 *
 * 口径（保守、不造数、与赛狐隔离）：
 * - 退货侧仅 AmazonReturnRecord（SP-API Returns 真实报告），沿用"单份已发布报告"口径，
 *   避免跨报告快照重复计；销量侧为 AmazonOrderItemRecord × AmazonOrderRecord 同期已发布订单。
 * - 聚合维度：站点 + SKU；指标：退货件数、退货去重订单数、同期销量件数、退货率。
 * - 退货率 = 退货件数 / 同期销量件数；分母为 0 或缺失时为 null（不补零、不估算）。
 * - 质量归因按 disposition 关键字分 sellable / defective / unsellable / other 四类，仅分类不改写原值。
 * - 数量非金额，不折算、不混算币种；同一订单多行退货按 quantity 累加，订单数按 distinct orderId。
 */

export type QualityClass = "sellable" | "defective" | "unsellable" | "other";

export type ReturnLineInput = {
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  amazonOrderId: string;
  quantity: number;
  disposition: string | null;
  reasonCode?: string | null;
};

export type ReturnAttributionRow = {
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  returnUnits: number;
  returnOrders: number;
  soldUnits: number | null;
  returnRate: string | null;
  sellable: number;
  defective: number;
  unsellable: number;
  other: number;
};

export type ReturnAttributionSummary = {
  skuCount: number;
  returnUnits: number;
  returnOrders: number;
  soldUnits: number;
  returnRate: string | null;
  sellable: number;
  defective: number;
  unsellable: number;
  other: number;
};

/** 纯函数：disposition 原值 → 质量归因分类（不改写原值，仅归类）。 */
export function classifyDisposition(disposition: string | null): QualityClass {
  if (!disposition) return "other";
  const v = disposition.toLowerCase();
  if (/unsellable|unfulfillable/i.test(v)) return "unsellable";
  if (/defect|damag|broken|malfunction/i.test(v)) return "defective";
  if (/sellable|like[\s_-]*new/i.test(v)) return "sellable";
  return "other";
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

type SoldKey = string;
const soldKey = (marketplaceId: string, sellerSku: string): SoldKey => `${marketplaceId}\u0000${sellerSku}`;

/**
 * 纯函数：退货行 + 同期销量映射 → 站点×SKU 退货归因行。
 * soldByKey 缺省（无同期销量）时 soldUnits/returnRate 为 null，绝不假设销量。
 */
export function buildReturnAttribution(
  returns: ReturnLineInput[],
  soldByKey: Map<SoldKey, number>,
  hasSalesUniverse: boolean,
): ReturnAttributionRow[] {
  const groups = new Map<string, {
    marketplaceId: string; sellerSku: string; asin: string;
    returnUnits: number; orders: Set<string>;
    sellable: number; defective: number; unsellable: number; other: number;
  }>();
  for (const r of returns) {
    const key = soldKey(r.marketplaceId, r.sellerSku);
    let g = groups.get(key);
    if (!g) {
      g = { marketplaceId: r.marketplaceId, sellerSku: r.sellerSku, asin: r.asin, returnUnits: 0, orders: new Set(), sellable: 0, defective: 0, unsellable: 0, other: 0 };
      groups.set(key, g);
    }
    g.returnUnits += r.quantity;
    if (r.amazonOrderId) g.orders.add(r.amazonOrderId);
    const q = classifyDisposition(r.disposition);
    if (q === "sellable") g.sellable += r.quantity;
    else if (q === "defective") g.defective += r.quantity;
    else if (q === "unsellable") g.unsellable += r.quantity;
    else g.other += r.quantity;
  }
  return [...groups.values()].map(g => {
    const sold = hasSalesUniverse ? (soldByKey.get(soldKey(g.marketplaceId, g.sellerSku)) ?? 0) : null;
    return {
      marketplaceId: g.marketplaceId,
      sellerSku: g.sellerSku,
      asin: g.asin,
      returnUnits: g.returnUnits,
      returnOrders: g.orders.size,
      soldUnits: sold,
      returnRate: sold !== null && sold > 0 ? fmt(g.returnUnits / sold) : null,
      sellable: g.sellable,
      defective: g.defective,
      unsellable: g.unsellable,
      other: g.other,
    };
  }).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId) || a.sellerSku.localeCompare(b.sellerSku));
}

/** 纯函数：归因行 → 汇总（总退货率按总件数/总销量重算而非行平均；退货订单数全局 distinct）。 */
export function buildReturnAttributionSummary(rows: ReturnAttributionRow[], distinctOrderIds?: Set<string>): ReturnAttributionSummary {
  const sum = (k: "returnUnits" | "sellable" | "defective" | "unsellable" | "other") => rows.reduce((n, r) => n + r[k], 0);
  const returnUnits = sum("returnUnits");
  const soldUnits = rows.reduce((n, r) => n + (r.soldUnits ?? 0), 0);
  const hasSales = rows.some(r => r.soldUnits !== null);
  return {
    skuCount: rows.length,
    returnUnits,
    returnOrders: distinctOrderIds ? distinctOrderIds.size : rows.reduce((n, r) => n + r.returnOrders, 0),
    soldUnits: hasSales ? soldUnits : 0,
    returnRate: hasSales && soldUnits > 0 ? fmt(returnUnits / soldUnits) : null,
    sellable: sum("sellable"),
    defective: sum("defective"),
    unsellable: sum("unsellable"),
    other: sum("other"),
  };
}

export const RETURN_ANALYTICS_BASIS = [
  "退货率 + 质量归因口径（保守默认，迁移自 Wimoor OrdersReturnController）：",
  "1) 退货仅 AmazonReturnRecord（SP-API Returns 真实报告），沿用单份已发布报告口径，避免跨报告快照重复计；不接赛狐。",
  "2) 同期销量为 AmazonOrderItemRecord × AmazonOrderRecord 已发布订单，按相同站点+SKU、相同日期窗口聚合数量。",
  "3) 退货率 = 退货件数 / 同期销量件数；分母为 0 或无销量数据时为 null，不补零、不估算。",
  "4) 质量归因按 disposition 关键字归 sellable / defective / unsellable / other，仅分类不改写原值。",
  "5) 退货件数按 quantity 累加，退货订单数按 distinct amazonOrderId；数量非金额，不折算、不混算币种。",
].join("\n");

const ROW_CAP = 12000;
const SALES_CAP = 60000;

function parseDate(value: string | null, key: "from" | "to"): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new SyncInputError(`退货归因${key}日期无效。`);
  }
  return key === "from" ? new Date(value) : new Date(Date.parse(value) + 86400000);
}

/** 只读：单份已发布退货报告 + 同期订单销量 → 退货归因报表。 */
export async function readReturnAnalytics(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: ReturnAttributionRow[]; summary: ReturnAttributionSummary; basis: string;
  reportId: string | null; from: string; to: string; hasSalesUniverse: boolean; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "returns");
  params = new URLSearchParams(params);
  const from = parseDate(params.get("from"), "from");
  const to = parseDate(params.get("to"), "to");
  if (from && to && from >= to) throw new SyncInputError("退货归因日期范围无效。");
  const toDate = to ?? new Date();
  const fromDate = from ?? new Date(toDate.getTime() - 30 * 86400000);
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const skuFilter = params.get("sku")?.trim().slice(0, 200) ?? "";

  return await prisma.$transaction(async tx => {
    const sources = await tx.amazonSyncDataSource.findMany({
      where: { AND: [scope, sellerAccessWhere(access), { resource: "returns" }] },
      orderBy: { id: "asc" }, take: 201,
      select: { id: true, authorizationId: true, sellerAccountId: true, marketplaceId: true, coverage: true },
    });
    if (sources.length > 200) throw new SyncInputError("退货数据源超过试点容量。", 409);

    const candidateReports = await tx.amazonSyncRun.findMany({
      where: { ...scope, resource: "returns", status: "SUCCEEDED", sourceId: { in: sources.map(s => s.id) } },
      orderBy: { finishedAt: "desc" }, take: 200,
      select: { sourceId: true, summary: true },
    });
    const published = new Map<string, string>();
    for (const run of candidateReports) {
      const rid = (run.summary as { coverage?: { reportId?: string } } | null)?.coverage?.reportId;
      if (rid && run.sourceId && !published.has(run.sourceId)) published.set(run.sourceId, rid);
    }
    const activeSources = sources.filter(s => published.has(s.id));
    const returnWhere: Prisma.AmazonReturnRecordWhereInput = {
      ...scope,
      sourceId: { in: activeSources.map(s => s.id) },
      returnAt: { gte: fromDate, lt: toDate },
      ...(skuFilter ? { sellerSku: { contains: skuFilter } } : {}),
    };
    const reportBySource = published;
    const rawReturns = await tx.amazonReturnRecord.findMany({
      where: returnWhere, take: ROW_CAP + 1,
      orderBy: { returnAt: "desc" },
      select: { sourceId: true, reportId: true, marketplaceId: true, sellerSku: true, asin: true, amazonOrderId: true, quantity: true, disposition: true },
    });
    // 仅保留每个 source 最新已发布 reportId 的行，避免跨报告重复计。
    const returnLines: ReturnLineInput[] = [];
    for (const r of rawReturns) {
      if (reportBySource.get(r.sourceId) !== r.reportId) continue;
      const sku = (r.sellerSku ?? "").trim();
      if (!sku) continue;
      returnLines.push({
        marketplaceId: r.marketplaceId, sellerSku: sku, asin: r.asin ?? "",
        amazonOrderId: r.amazonOrderId, quantity: r.quantity, disposition: r.disposition,
      });
      if (returnLines.length >= ROW_CAP) break;
    }

    // 同期销量：已发布订单 × 订单商品，按站点+SKU 聚合数量。
    const soldByKey = new Map<SoldKey, number>();
    let hasSalesUniverse = false;
    let salesTruncated = false;
    const orderPageSize = 5000;
    let cursor: string | undefined;
    let scanned = 0;
    while (scanned < SALES_CAP) {
      const orders = await tx.amazonOrderRecord.findMany({
        where: {
          ...scope,
          createdTime: { gte: fromDate, lt: toDate },
          ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" }, take: orderPageSize,
        select: {
          id: true, marketplaceId: true, sellerAccountId: true,
          items: { select: { sellerSku: true, quantityOrdered: true } },
        },
      });
      if (!orders.length) break;
      hasSalesUniverse = true;
      for (const o of orders) {
        for (const it of o.items) {
          const sku = (it.sellerSku ?? "").trim();
          if (!sku) continue;
          const key = soldKey(o.marketplaceId, sku);
          soldByKey.set(key, (soldByKey.get(key) ?? 0) + it.quantityOrdered);
        }
      }
      scanned += orders.length;
      if (orders.length < orderPageSize) break;
      cursor = orders[orders.length - 1].id;
    }
    salesTruncated = scanned >= SALES_CAP;

    const rows = buildReturnAttribution(returnLines, soldByKey, hasSalesUniverse);
    const allOrderIds = new Set(returnLines.filter(r => r.amazonOrderId).map(r => r.amazonOrderId));
    return {
      rows,
      summary: buildReturnAttributionSummary(rows, allOrderIds),
      basis: RETURN_ANALYTICS_BASIS,
      reportId: published.values().next().value ?? null,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      hasSalesUniverse,
      asOf: new Date().toISOString(),
      truncated: rawReturns.length > ROW_CAP || salesTruncated,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
