/**
 * 展示币种换算（只读、审计可追溯）。
 *
 * 架构红线：绝不臆造汇率。只有携带 reference/evidence 且已复核的 ACTIVE 汇率
 * （FinanceExchangeRate 的 reviewedBy 非空）才会进入 fxMap；缺任一条件即不换算，
 * 保留原币种展示。金额换算仅用于展示，不写回数据库、不改变导出原始数据。
 */

export type ReviewedFxRate = {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  reference: string;
  observedAt: string;
};

export type FxMap = Map<string, ReviewedFxRate>;

function pairKey(source: string, target: string) {
  return `${source.toUpperCase()}->${target.toUpperCase()}`;
}

/** 只接纳通过审查的汇率条目；数值非法/缺失来源的条目一律丢弃。 */
export function buildFxMap(rates: unknown[]): FxMap {
  const map: FxMap = new Map();
  for (const raw of rates) {
    if (typeof raw !== "object" || raw === null) continue;
    const rate = raw as Record<string, unknown>;
    const source = typeof rate.sourceCurrency === "string" ? rate.sourceCurrency.toUpperCase() : "";
    const target = typeof rate.targetCurrency === "string" ? rate.targetCurrency.toUpperCase() : "";
    const value = typeof rate.rate === "number" ? rate.rate : Number(rate.rate);
    const reference = typeof rate.reference === "string" ? rate.reference.trim() : "";
    if (!source || !target || source === target || !reference) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    map.set(pairKey(source, target), {
      sourceCurrency: source,
      targetCurrency: target,
      rate: value,
      reference,
      observedAt: typeof rate.observedAt === "string" ? rate.observedAt : "",
    });
  }
  return map;
}

/** 可切换的目标币种：由已复核汇率的目标币去重得到，按 code 稳定排序。 */
export function availableDisplayCurrencies(map: FxMap): string[] {
  return [...new Set([...map.values()].map((item) => item.targetCurrency))].sort();
}

export type DisplayMoneyResult = {
  /** 展示文本（不含币种前缀时的纯数值格式化由调用方决定）。 */
  value: number;
  /** 实际采用的币种 code（换算成功时为目标币，否则为原币）。 */
  currency: string;
  /** 是否发生了换算；仅在命中已复核汇率时为 true。 */
  converted: boolean;
  /** 换算来源（reference + 观测时间），供 title/审计提示使用；未换算为空。 */
  audit?: string;
};

/**
 * 把金额换算到目标展示币种。仅在存在已复核的 source→target 汇率时换算；
 * 目标币为空、原币缺失、同币种或汇率缺失时返回原值（converted=false）。
 */
export function convertForDisplay(
  amount: number | null,
  sourceCurrency: unknown,
  displayCurrency: string,
  map: FxMap,
): DisplayMoneyResult {
  const source = typeof sourceCurrency === "string" && sourceCurrency ? sourceCurrency.toUpperCase() : "";
  const target = (displayCurrency ?? "").toUpperCase();
  const base: DisplayMoneyResult = { value: amount ?? 0, currency: source, converted: false };
  if (amount == null || !Number.isFinite(amount) || !target || !source || source === target) return base;
  const hit = map.get(pairKey(source, target));
  if (!hit) return base;
  return {
    value: amount * hit.rate,
    currency: target,
    converted: true,
    audit: `按已复核汇率 ${hit.reference}${hit.observedAt ? `（${hit.observedAt}）` : ""} 换算，仅用于展示`,
  };
}
