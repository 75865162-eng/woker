/**
 * 报告3 阶段 P0-4 / G6：供应商 / 承运商月度对账汇总（纯函数）。
 *
 * 背景：审计指出本项目只有逐笔 FinanceOpenItem/FinanceSettlement，缺 WIMOR
 * FinSupplierReconcileRecord / FinCarrierReconcileRecord 的月度汇总视角。
 *
 * 本模块提供纯计算层：把开放项（应收/应付单据）与核销记录（付款）按 counterparty
 * 与账期(YYYY-MM)聚合，输出月度对账汇总。遵循红线：
 * - 委托方/承运方由调用方按 kind 显式分类（supplier: / carrier: 前缀），不猜；
 * - 金额用 BigInt 6 位精度字符串运算，不跨币种相加（按 currency 分列）；
 * - 已冲销的结算（reversedBy 非空）不计入已付；
 * - 不写库，结果供展示/落库任务消费。
 */
export class ReconcileRuleError extends Error {}
const zero = BigInt(0);
const SCALE = BigInt(1_000_000);
function requireRule(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ReconcileRuleError(msg);
}
function money(value: string): bigint {
  requireRule(typeof value === "string" && /^-?\d{1,24}(?:\.\d{1,6})?$/.test(value), "金额须为最多六位小数的十进制字符串。");
  const neg = value.startsWith("-");
  const [whole, frac = ""] = (neg ? value.slice(1) : value).split(".");
  const r = BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
  return neg ? -r : r;
}
function amount(v: bigint): string {
  const abs = v < zero ? -v : v;
  return `${v < zero ? "-" : ""}${abs / SCALE}.${String(abs % SCALE).padStart(6, "0")}`;
}

export type OpenItemInput = {
  id: string;
  counterparty: string;
  /** supplier / carrier / 其它由调用方分类；这里只用其做前缀归类 */
  kind: string;
  currency: string;
  amount: string;
  status: string;
};
export type SettlementInput = {
  documentId: string;
  amount: string;
  /** 非空表示该核销已冲销，不计入已付 */
  reversedBy: string | null;
  date: string;
};

export type MonthlyReconcile = {
  reconcileMonth: string;
  counterparty: string;
  currency: string;
  orderCount: number;
  totalOrderAmount: string;
  totalPaid: string;
  totalUnpaid: string;
};

/**
 * 按 counterparty + 币种 + 账期聚合开放项为月度对账汇总。
 * amount 为单据金额；已核销金额从 settlement 汇总（按 documentId 关联、排除冲销）。
 * periodOf(date) 由调用方提供账期归属（如 YYYY-MM），不内置时区假设。
 */
export function buildMonthlyReconcile(
  items: readonly OpenItemInput[],
  settlements: readonly SettlementInput[],
  periodOf: (item: OpenItemInput) => string,
): MonthlyReconcile[] {
  const paidByDoc = new Map<string, bigint>();
  for (const s of settlements) {
    if (s.reversedBy) continue;
    const v = paidByDoc.get(s.documentId) ?? zero;
    paidByDoc.set(s.documentId, v + money(s.amount));
  }
  const groups = new Map<string, {
    period: string; counterparty: string; currency: string;
    count: number; total: bigint; paid: bigint;
  }>();
  for (const item of items) {
    requireRule(/^[A-Z]{3}$/.test(item.currency), "往来项币种须为三位大写代码。");
    const period = periodOf(item);
    requireRule(/^\d{4}-\d{2}$/.test(period), "账期须为 YYYY-MM。");
    const key = `${period}|${item.counterparty}|${item.currency}`;
    let g = groups.get(key);
    if (!g) { g = { period, counterparty: item.counterparty, currency: item.currency, count: 0, total: zero, paid: zero }; groups.set(key, g); }
    g.count += 1;
    g.total += money(item.amount);
    g.paid += paidByDoc.get(item.id) ?? zero;
  }
  return [...groups.values()]
    .sort((a, b) => a.period.localeCompare(b.period) || a.counterparty.localeCompare(b.counterparty) || a.currency.localeCompare(b.currency))
    .map((g) => ({
      reconcileMonth: g.period,
      counterparty: g.counterparty,
      currency: g.currency,
      orderCount: g.count,
      totalOrderAmount: amount(g.total),
      totalPaid: amount(g.paid),
      totalUnpaid: amount(g.total - g.paid),
    }));
}

/** 从 counterparty 前缀归类供应商/承运商（不猜未标记的项）。 */
export function classifyCounterparty(counterparty: string): "supplier" | "carrier" | "unknown" {
  if (counterparty.startsWith("supplier:")) return "supplier";
  if (counterparty.startsWith("carrier:")) return "carrier";
  return "unknown";
}
