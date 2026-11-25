/**
 * 报告2 阶段 P0-2：销售日汇总事实口径（纯函数）。
 *
 * 背景：审计指出 woker 无销售/订单汇总落库层，销量/订单量/退款量/均价需实时派生，
 * 商品页、结算 SKU、利润页、库存规划页共同受阻；WIMOOR 有 OrdersSummary/SKU 汇总行。
 *
 * 本模块提供**权威事实口径的纯函数**：把订单行与退款行按
 * (sellerSku, asin, businessDate, currency) 聚合为可落库的 SalesDailyFact 行形状。
 * 遵循红线（与 order-period-summary.ts / 整改口径一致）：
 * - orderCount = distinct amazonOrderId（订单项数不冒充订单数）；
 * - grossSales 按币种分列求和（字符串保真，绝不跨币种相加）；
 * - 退款行冲减 units/refundAmount，但不冲减订单数；
 * - 缺值不补零：数量为 null 的分量使对应聚合为 null（NULL-preserving）；
 * - 不写库、不臆造；落库任务/对账可直接消费本函数输出。
 */
const SCALE = 1_000_000;
const fmt = (n: number): string => {
  const r = Math.round(n * SCALE) / SCALE;
  return Object.is(r, -0) ? "0" : String(r);
};
const dec = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

export type SalesFactLine = {
  amazonOrderId: string;
  sellerSku: string | null;
  asin: string | null;
  businessDate: string;
  currency: string | null;
  /** 销售数量（退款行的 quantity 应为负或单独标注） */
  quantity: number | string | null;
  /** 订单金额（原币，退款行金额为负） */
  amount: string | number | null;
  /** 该行是否为退款行：退款行计入 refunds，不新增订单数 */
  isRefund?: boolean;
};

export type SalesDailyFactRow = {
  sellerSku: string | null;
  asin: string | null;
  businessDate: string;
  currency: string;
  unitsOrdered: string | null;
  orderCount: number;
  grossSales: string;
  refundUnits: string | null;
  refundAmount: string;
  netUnits: string | null;
  netSales: string;
  lineCount: number;
};

type Bucket = {
  sellerSku: string | null; asin: string | null; businessDate: string; currency: string;
  orderIds: Set<string>; units: number | null; sales: number;
  refundUnits: number | null; refundAmount: number; lineCount: number;
};

/**
 * 聚合销售日事实。分组键 = (sellerSku, asin, businessDate, currency)。
 * - 销售行：累计 orderIds（distinct）、units、sales；
 * - 退款行：累计 refundUnits、refundAmount（调用方应传负值金额/数量，或此处取绝对值冲减）；
 * - units/refundUnits 任一分量缺失 → 对应字段 null（NULL-preserving）。
 */
export function buildSalesDailyFacts(lines: readonly SalesFactLine[]): SalesDailyFactRow[] {
  const buckets = new Map<string, Bucket>();
  const keyOf = (l: SalesFactLine) =>
    `${l.businessDate}|${l.sellerSku ?? "~"}|${l.asin ?? "~"}|${(l.currency ?? "").toUpperCase() || "~"}`;

  for (const l of lines) {
    requireDate(l.businessDate);
    const currency = (l.currency ?? "").toUpperCase();
    if (!currency) continue; // 无币种的行不进入分币种事实（不臆造币种）
    const key = keyOf(l);
    let b = buckets.get(key);
    if (!b) {
      b = { sellerSku: l.sellerSku ?? null, asin: l.asin ?? null, businessDate: l.businessDate, currency,
        orderIds: new Set(), units: 0, sales: 0, refundUnits: 0, refundAmount: 0, lineCount: 0 };
      buckets.set(key, b);
    }
    b.lineCount += 1;
    const qty = dec(l.quantity);
    const amount = dec(l.amount);
    if (l.isRefund) {
      // 退款：以绝对值累计退款量/退款额（调用方传正或负都归一为正的退款口径）
      if (qty === null) b.refundUnits = null;
      else if (b.refundUnits !== null) b.refundUnits += Math.abs(qty);
      if (amount !== null) b.refundAmount += Math.abs(amount);
    } else {
      b.orderIds.add(l.amazonOrderId);
      if (qty === null) b.units = null;
      else if (b.units !== null) b.units += qty;
      if (amount !== null) b.sales += amount;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate)
      || (a.sellerSku ?? "").localeCompare(b.sellerSku ?? "")
      || (a.asin ?? "").localeCompare(b.asin ?? "")
      || a.currency.localeCompare(b.currency))
    .map((b) => ({
      sellerSku: b.sellerSku,
      asin: b.asin,
      businessDate: b.businessDate,
      currency: b.currency,
      unitsOrdered: b.units === null ? null : fmt(b.units),
      orderCount: b.orderIds.size,
      grossSales: fmt(b.sales),
      refundUnits: b.refundUnits === null ? null : fmt(b.refundUnits),
      refundAmount: fmt(b.refundAmount),
      netUnits: b.units === null || b.refundUnits === null ? null : fmt(b.units - b.refundUnits),
      netSales: fmt(b.sales - b.refundAmount),
      lineCount: b.lineCount,
    }));
}

function requireDate(d: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`业务日期须为 YYYY-MM-DD：${d}`);
}

/** 事实行口径说明（供 API basis / 前端审计提示）。 */
export const SALES_DAILY_FACT_BASIS = [
  "销售日事实口径：分组 (sellerSku, asin, businessDate, currency)。",
  "1) orderCount=distinct amazonOrderId；退款行不新增订单数。",
  "2) grossSales 按币种分列（字符串保真，不跨币种相加）。",
  "3) 退款行冲减 units/refundAmount，以绝对值累计；net = 销售 - 退款。",
  "4) 数量分量缺失 → null（不补零）；无币种的行不纳入。",
].join("\n");
