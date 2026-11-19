/**
 * Sellfox listing derived columns — read-time computation only, never persisted.
 *
 * Red line (mirrors docs/field-level-upgrade-guide-5-items.md §二):
 *   - Any factor missing/null -> result null. Never COALESCE(...,0), because treating a
 *     missing cost as zero fabricates profit ("缺成本算成 0 成本").
 *   - Rates are guarded against non-positive denominators -> null.
 *   - "预估利润"(profitPrice, our口径) and "毛利润"(grossProfit, Sellfox口径) coexist;
 *     the two口径 are intentionally different and must not overwrite each other.
 *
 * These are pure functions over a normalized row object so they are unit-testable with
 * explicit fixtures. Fixtures are test inputs, never presented as real business data.
 */

export type DerivedInput = Record<string, unknown>;

/** Read a finite number, or null when absent/invalid. No zero fallback. */
function num(row: DerivedInput, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Sum of present factors; null when any factor is missing. Any factor null -> null. */
function sumRequired(row: DerivedInput, keys: readonly string[]): number | null {
  let total = 0;
  for (const key of keys) {
    const value = num(row, key);
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** 预计费用 = FBA费用 + 佣金 + 运费；任一缺失则 null。 */
export function estimatedFee(row: DerivedInput): number | null {
  return sumRequired(row, ["fbaFees", "referralFee", "shippingPrice"]);
}

/**
 * 毛利润（赛狐口径）= 售价 − (采购成本 + 头程 + 预计费用)；任一因子缺失则 null。
 * 与 profitPrice（我方预估利润口径）并存，互不覆盖。
 */
export function grossProfit(row: DerivedInput): number | null {
  const price = num(row, "price");
  const cost = sumRequired(row, ["purchaseCost", "headTripCost"]);
  const fee = estimatedFee(row);
  if (price === null || cost === null || fee === null) return null;
  return price - (cost + fee);
}

/** 毛利率 = 毛利润 / 售价；售价 <= 0 或任一因子缺失则 null。 */
export function grossProfitRate(row: DerivedInput): number | null {
  const profit = grossProfit(row);
  const price = num(row, "price");
  if (profit === null || price === null || price <= 0) return null;
  return profit / price;
}

/** 利润率（我方口径）= profitPrice / 售价；售价 <= 0 或缺失则 null。 */
export function profitRate(row: DerivedInput): number | null {
  const profit = num(row, "profitPrice");
  const price = num(row, "price");
  if (profit === null || price === null || price <= 0) return null;
  return profit / price;
}

/** Apply all listing derived columns onto a row, in place. Missing stays null. */
export function applyListingDerived(row: DerivedInput): DerivedInput & {
  estimatedFee: number | null;
  grossProfit: number | null;
  grossProfitRate: number | null;
} {
  const out = row as DerivedInput & {
    estimatedFee: number | null;
    grossProfit: number | null;
    grossProfitRate: number | null;
  };
  out.estimatedFee = estimatedFee(row);
  out.grossProfit = grossProfit(row);
  out.grossProfitRate = grossProfitRate(row);
  return out;
}
