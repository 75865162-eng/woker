import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
import { amazonAccountReadAccess } from "./read-account";

/**
 * 最终利润（Wimoor 结算月度汇总 + SKU 成本分摊链路对标，迁移到亚马逊模块）。
 *
 * 完整链路：亚马逊结算行（SP-API 真实数据）按 SKU×币种聚结算净额
 *        → 关联该 SKU 的用户录入成本（采购/头程/其他，原币）
 *        → 按用户配置汇率折算到结算币种
 *        → 净利润 = 结算净额 − 折算后成本。
 *
 * 保守口径（用户确认 + 本项目原则）：
 * - 数据源仅 AmazonSettlementRow（ATTRIBUTED）与用户显式录入的 AmazonSkuCost / AmazonFxRate，
 *   不接赛狐、不含 ERP 财务、不自动抓汇率。
 * - 只统计 ATTRIBUTED 行；结算净额 = 所有交易类型金额带符号求和（Order 正、Refund/FBAFees 负）。
 * - 订单数按 distinct orderId；缺金额/缺业务日不补零、不估算。
 * - 金额字符串保真（最多 6 位小数），汇率 8 位。
 * - 无成本记录 → 成本与净利润留 null；有成本但跨币种且无汇率 → 净利润留 null 并写明原因。
 *   绝不臆造汇率、不缺值补零、不造数。
 * - 同币种（成本币种 == 结算币种）无需汇率，直接相减。
 */

export type SkuSettlementLine = {
  sku: string;
  currency: string;
  amount: string | null;
  orderId: string | null;
  transactionType: string | null;
};

export type SkuCostInput = {
  sku: string;
  costCurrency: string;
  purchaseCost: string;
  freightCost: string;
  otherCost: string;
};

export type FxRateInput = { from: string; to: string; rate: string };

export type SkuSettlementAggregate = {
  sku: string;
  currency: string;
  lineCount: number;
  distinctOrders: number;
  settlementNet: string; // 结算净额（原币，带符号）
  typeBreakdown: Record<string, string>; // 交易类型 → 金额（原币）
};

export type SkuFinalProfitRow = {
  sku: string;
  settlementCurrency: string;
  lineCount: number;
  distinctOrders: number;
  settlementNet: string; // 结算净额（结算币种）
  typeBreakdown: Record<string, string>;
  costCurrency: string | null; // 录入成本的原币
  purchaseCost: string | null;
  freightCost: string | null;
  otherCost: string | null;
  costTotalOriginal: string | null; // 成本合计（原币）
  fxRate: string | null; // 使用的汇率（cost→settlement）；同币种为 "1"
  costTotalConverted: string | null; // 折算到结算币种的成本
  netProfit: string | null; // 最终净利润 = 结算净额 − 折算成本；缺值留 null
  netMargin: string | null; // 净利率 = 净利润 / 结算净额；分母为 0 或缺失为 null
  status: "OK" | "NO_COST" | "NO_FX_RATE" | "SAME_CURRENCY";
  note: string | null;
};

/** 安全十进制解析：兼容逗号作小数分隔符的 locale 格式（BRL/欧洲 "115,31"/"-17,61"）。 */
function dec(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  let normalized = value.trim();
  if (normalized.includes(",")) {
    if (normalized.includes(".")) normalized = normalized.replace(/\./g, ""); // 点=千分位
    normalized = normalized.replace(",", "."); // 逗号=小数点
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** 纯函数：结算行 → 按 SKU×币种聚结算净额与交易类型分列。 */
export function buildSkuSettlementAggregates(lines: SkuSettlementLine[]): SkuSettlementAggregate[] {
  const groups = new Map<string, {
    sku: string; currency: string; lineCount: number; net: number;
    orders: Set<string>; types: Map<string, number>;
  }>();
  for (const line of lines) {
    const sku = (line.sku ?? "").trim();
    const currency = (line.currency ?? "").trim();
    if (!sku || !currency) continue;
    const key = `${sku}\u0000${currency}`;
    let g = groups.get(key);
    if (!g) {
      g = { sku, currency, lineCount: 0, net: 0, orders: new Set(), types: new Map() };
      groups.set(key, g);
    }
    g.lineCount += 1;
    const amount = dec(line.amount);
    g.net += amount;
    const type = (line.transactionType ?? "").trim() || "UNKNOWN";
    g.types.set(type, (g.types.get(type) ?? 0) + amount);
    if (line.orderId) g.orders.add(line.orderId);
  }
  return [...groups.values()].map(g => ({
    sku: g.sku,
    currency: g.currency,
    lineCount: g.lineCount,
    distinctOrders: g.orders.size,
    settlementNet: fmt(g.net),
    typeBreakdown: Object.fromEntries([...g.types.entries()].map(([t, v]) => [t, fmt(v)])),
  })).sort((a, b) => a.currency.localeCompare(b.currency) || a.sku.localeCompare(b.sku));
}

/** 汇率索引：from→to 的 rate；无配置返回 null。 */
function fxIndex(rates: FxRateInput[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rates) {
    const from = (r.from ?? "").trim().toUpperCase();
    const to = (r.to ?? "").trim().toUpperCase();
    const rate = dec(r.rate);
    if (from && to && rate > 0) m.set(`${from}\u0000${to}`, rate);
  }
  return m;
}

/** 成本索引：SKU + 成本币种 → 成本（同一 SKU 多币种分别录入）。 */
function costIndex(costs: SkuCostInput[]): Map<string, SkuCostInput> {
  const m = new Map<string, SkuCostInput>();
  for (const c of costs) {
    const sku = (c.sku ?? "").trim();
    const ccy = (c.costCurrency ?? "").trim().toUpperCase();
    if (!sku || !ccy) continue;
    const key = `${sku}\u0000${ccy}`;
    const prev = m.get(key);
    if (!prev) m.set(key, c);
  }
  return m;
}

/** 纯函数：结算聚合 + 成本录入 + 汇率 → 最终利润行（缺值留 null，不造数）。 */
export function buildSkuFinalProfit(
  aggregates: SkuSettlementAggregate[],
  costs: SkuCostInput[],
  rates: FxRateInput[],
): SkuFinalProfitRow[] {
  const cIdx = costIndex(costs);
  const fIdx = fxIndex(rates);

  return aggregates.map(a => {
    const base = {
      sku: a.sku,
      settlementCurrency: a.currency,
      lineCount: a.lineCount,
      distinctOrders: a.distinctOrders,
      settlementNet: a.settlementNet,
      typeBreakdown: a.typeBreakdown,
    };
    // 成本录入：优先取与结算币种同币种的记录，否则取第一条（并按其原币折算）。
    const sameCurrencyCost = cIdx.get(`${a.sku}\u0000${a.currency.toUpperCase()}`);
    const anyCost = sameCurrencyCost ?? costs.find(c => (c.sku ?? "").trim() === a.sku);
    if (!anyCost) {
      return {
        ...base,
        costCurrency: null, purchaseCost: null, freightCost: null, otherCost: null,
        costTotalOriginal: null, fxRate: null, costTotalConverted: null,
        netProfit: null, netMargin: null,
        status: "NO_COST" as const,
        note: "未录入该 SKU 成本，净利润留空（不造数）",
      };
    }
    const costCurrency = (anyCost.costCurrency ?? "").trim().toUpperCase() || "CNY";
    const purchase = dec(anyCost.purchaseCost);
    const freight = dec(anyCost.freightCost);
    const other = dec(anyCost.otherCost);
    const costTotal = purchase + freight + other;
    const costFields = {
      costCurrency,
      purchaseCost: fmt(purchase),
      freightCost: fmt(freight),
      otherCost: fmt(other),
      costTotalOriginal: fmt(costTotal),
    };

    // 同币种：无需汇率，直接相减。
    if (costCurrency === a.currency.toUpperCase()) {
      const net = dec(a.settlementNet) - costTotal;
      const denom = dec(a.settlementNet);
      return {
        ...base, ...costFields,
        fxRate: "1", costTotalConverted: fmt(costTotal),
        netProfit: fmt(net),
        netMargin: denom !== 0 ? fmt(net / denom) : null,
        status: "SAME_CURRENCY" as const,
        note: "成本币种与结算币种相同，直接相减",
      };
    }

    // 跨币种：必须用户配置汇率才折算；否则留空。
    const rate = fIdx.get(`${costCurrency}\u0000${a.currency.toUpperCase()}`);
    if (!rate) {
      return {
        ...base, ...costFields,
        fxRate: null, costTotalConverted: null,
        netProfit: null, netMargin: null,
        status: "NO_FX_RATE" as const,
        note: `成本币种 ${costCurrency} 与结算币种 ${a.currency} 不同，未配置 ${costCurrency}→${a.currency} 汇率，净利润留空`,
      };
    }
    const converted = costTotal * rate;
    const net = dec(a.settlementNet) - converted;
    const denom = dec(a.settlementNet);
    return {
      ...base, ...costFields,
      fxRate: String(rate),
      costTotalConverted: fmt(converted),
      netProfit: fmt(net),
      netMargin: denom !== 0 ? fmt(net / denom) : null,
      status: "OK" as const,
      note: `成本按用户配置汇率 ${costCurrency}→${a.currency}=${rate} 折算`,
    };
  }).sort((a, b) =>
    (a.netProfit === null ? 1 : 0) - (b.netProfit === null ? 1 : 0) ||
    a.settlementCurrency.localeCompare(b.settlementCurrency) ||
    a.sku.localeCompare(b.sku));
}

export const SKU_PROFIT_FINAL_BASIS = [
  "最终利润口径（保守默认，迁移自 Wimoor 结算汇总 + SKU 成本分摊）：",
  "1) 数据源仅 AmazonSettlementRow（ATTRIBUTED 真实结算行）+ 用户显式录入的 SKU 成本与汇率；不接赛狐、不含 ERP 财务、不自动抓汇率。",
  "2) 结算净额 = 该 SKU 全部交易类型金额带符号求和（Order 收入正、Refund/FBAFees/Retrocharge/AmazonFees 费用负）。",
  "3) 订单数按 distinct orderId；缺金额/缺业务日不补零；金额字符串保真，汇率 8 位。",
  "4) 成本 = 用户录入的采购 + 头程 + 其他（原币）；同币种直接相减，跨币种须用户配置汇率才折算。",
  "5) 净利润 = 结算净额 − 折算成本；未录成本或缺汇率时净利润留 null 并写明原因，绝不臆造。",
  "6) 净利率 = 净利润 / 结算净额；分母为 0 或缺失为 null。",
].join("\n");

const ROW_CAP = 60000;

/** 只读：已归属结算行 + 用户成本 + 汇率 → 最终利润报表。 */
export async function readSkuProfitFinal(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: SkuFinalProfitRow[]; basis: string; asOf: string;
  totalLines: number; costCount: number; fxCount: number; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "settlements");
  const sellerIds = access.allSellers ? [] : access.sellerIds;
  const currencyFilter = params.get("currency")?.trim().slice(0, 20) ?? "";
  const skuFilter = params.get("sku")?.trim().slice(0, 200) ?? "";

  const [settlementRows, costRows, fxRows] = await Promise.all([
    prisma.amazonSettlementRow.findMany({
      where: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        attributionStatus: "ATTRIBUTED",
        ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
        ...(currencyFilter ? { currencyCode: currencyFilter } : {}),
        ...(skuFilter ? { sellerSku: { contains: skuFilter } } : {}),
        sellerSku: { not: null },
      },
      select: { sellerSku: true, currencyCode: true, amountOriginal: true, orderId: true, transactionType: true },
      orderBy: { businessDate: "desc" },
      take: ROW_CAP + 1,
    }),
    prisma.amazonSkuCost.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      select: { sku: true, costCurrency: true, purchaseCost: true, freightCost: true, otherCost: true },
    }),
    prisma.amazonFxRate.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      select: { fromCurrency: true, toCurrency: true, rate: true },
    }),
  ]);

  const lines: SkuSettlementLine[] = settlementRows.slice(0, ROW_CAP).map(r => ({
    sku: (r.sellerSku ?? "").trim(),
    currency: (r.currencyCode ?? "").trim(),
    amount: r.amountOriginal,
    orderId: r.orderId,
    transactionType: r.transactionType,
  }));
  const agg = buildSkuSettlementAggregates(lines);
  const costs: SkuCostInput[] = costRows.map(c => ({
    sku: c.sku, costCurrency: c.costCurrency,
    purchaseCost: String(c.purchaseCost), freightCost: String(c.freightCost), otherCost: String(c.otherCost),
  }));
  const rates: FxRateInput[] = fxRows.map(r => ({ from: r.fromCurrency, to: r.toCurrency, rate: String(r.rate) }));

  return {
    rows: buildSkuFinalProfit(agg, costs, rates),
    basis: SKU_PROFIT_FINAL_BASIS,
    asOf: new Date().toISOString(),
    totalLines: lines.length,
    costCount: costRows.length,
    fxCount: fxRows.length,
    truncated: settlementRows.length > ROW_CAP,
  };
}
