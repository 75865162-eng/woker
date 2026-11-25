/**
 * 报告3 阶段 P0-1：外币分录三栏校验（currency / originalAmount / exchangeRate）。
 *
 * 背景：审计指出 FinanceVoucherLine 仅 debit/credit（本位币），缺 Wimoor
 * FinVoucherEntries.currency/originalAmount/exchangeRate 三栏，外币凭证不可在原币维度还原。
 *
 * 设计原则（严守项目红线）：
 * - 不臆造汇率：汇率必须由调用方显式提供（来自已复核 FinanceExchangeRate），
 *   非正/非法汇率一律拒绝；本模块不查库、不猜值。
 * - 借贷平衡仍以本位币为准（现有 validateVoucher 不变，本模块是补充校验）。
 * - 原币 × 汇率 ≈ 本位币金额，带容差（万分之一 toleranceBp），用 BigInt 高精度避免浮点误差。
 * - 本位币分录（currency === bookCurrency）不强制三栏，保持向后兼容。
 *
 * 这是纯函数模块，不改 Voucher 类型、不触碰现有 rules.ts 行为，可独立测试。
 */
export class FxEntryRuleError extends Error {}
const zero = BigInt(0);
const SCALE = BigInt(1_000_000);          // 金额 6 位小数
const RATE_SCALE = BigInt(1_000_000_000_000); // 汇率 12 位小数
function requireRule(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new FxEntryRuleError(msg);
}

/** 金额字符串（最多 6 位小数）→  scaled BigInt。 */
function money(value: string): bigint {
  requireRule(typeof value === "string" && /^-?\d{1,24}(?:\.\d{1,6})?$/.test(value), "金额须为最多六位小数的十进制字符串。");
  const neg = value.startsWith("-");
  const [whole, frac = ""] = (neg ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
  return neg ? -result : result;
}

/** 汇率字符串（最多 12 位小数，正数）→ scaled BigInt。 */
function rate(value: string): bigint {
  requireRule(typeof value === "string" && /^\d{1,12}(?:\.\d{1,12})?$/.test(value), "汇率须为正的十进制字符串（最多 12 位小数）。");
  const [whole, frac = ""] = value.split(".");
  const result = BigInt(whole) * RATE_SCALE + BigInt(frac.padEnd(12, "0"));
  requireRule(result > zero, "汇率必须大于 0，不臆造汇率。");
  return result;
}

export type FxEntry = {
  /** 原币 code（三位大写）；等于 bookCurrency 时视作本位币分录 */
  currency: string;
  /** 原币金额（最多 6 位小数字符串）；外币分录必填 */
  originalAmount?: string | null;
  /** 原币→本位币汇率（正数，12 位小数字符串）；外币分录必填 */
  exchangeRate?: string | null;
  /** 本位币分录金额（debit 或 credit 一侧，最多 6 位小数字符串） */
  baseAmount: string;
};

export type FxEntryCheck = {
  kind: "BASE_CURRENCY" | "CONVERTED" | "NO_FX_DATA";
  baseAmount: string;
  originalAmount: string | null;
  exchangeRate: string | null;
  /** 原币×汇率的本位币理论值（仅 CONVERTED） */
  convertedBase: string | null;
  /** 绝对差额（仅 CONVERTED） */
  difference: string | null;
};

function scaledToMoney(value: bigint): string {
  const abs = value < zero ? -value : value;
  return `${value < zero ? "-" : ""}${abs / SCALE}.${String(abs % SCALE).padStart(6, "0")}`;
}

/**
 * 校验一条分录的原币三栏与本位币金额是否一致。
 * - currency === bookCurrency：返回 BASE_CURRENCY，忽略三栏（兼容存量本位币分录）。
 * - 外币但缺 originalAmount/exchangeRate：返回 NO_FX_DATA（不报错，标注缺失，绝不臆造换算）。
 * - 外币且三栏齐全：校验 originalAmount × exchangeRate ≈ baseAmount，超容差抛错。
 *
 * toleranceBp：容差（万分之一），默认 10（=0.1%）。用于吸收汇率展示精度与金额舍入差异。
 */
export function checkFxEntry(
  entry: FxEntry,
  bookCurrency: string,
  toleranceBp = 10,
): FxEntryCheck {
  requireRule(/^[A-Z]{3}$/.test(bookCurrency), "账套本位币须为三位大写代码。");
  requireRule(/^[A-Z]{3}$/.test(entry.currency), "分录原币须为三位大写代码。");
  const base = money(entry.baseAmount);
  requireRule(Number.isInteger(toleranceBp) && toleranceBp >= 0 && toleranceBp <= 10000, "容差须为 0~10000 之间的整数（万分之一）。");

  if (entry.currency === bookCurrency) {
    return { kind: "BASE_CURRENCY", baseAmount: entry.baseAmount, originalAmount: null, exchangeRate: null, convertedBase: null, difference: null };
  }

  if (!entry.originalAmount || !entry.exchangeRate) {
    // 外币但缺三栏：标注缺失，绝不臆造汇率换算。
    return { kind: "NO_FX_DATA", baseAmount: entry.baseAmount, originalAmount: entry.originalAmount ?? null, exchangeRate: entry.exchangeRate ?? null, convertedBase: null, difference: null };
  }

  const original = money(entry.originalAmount);
  const fx = rate(entry.exchangeRate);
  // convertedBase = original × fx；两者分别放大 SCALE 与 RATE_SCALE，结果需除以 RATE_SCALE 还原到金额域。
  const convertedScaled = (original * fx) / RATE_SCALE;
  const difference = convertedScaled - base;
  // 容差 = |base| × toleranceBp / 10000
  const tolerance = ((base < zero ? -base : base) * BigInt(toleranceBp)) / BigInt(10000);
  const absDiff = difference < zero ? -difference : difference;
  requireRule(absDiff <= tolerance, `原币×汇率(${scaledToMoney(convertedScaled)})与本位币(${scaledToMoney(base)})差额 ${scaledToMoney(absDiff)} 超出容差 ${scaledToMoney(tolerance)}。`);

  return {
    kind: "CONVERTED",
    baseAmount: entry.baseAmount,
    originalAmount: entry.originalAmount,
    exchangeRate: entry.exchangeRate,
    convertedBase: scaledToMoney(convertedScaled),
    difference: scaledToMoney(difference),
  };
}

/**
 * 批量校验：凭证的每条分录逐一检查，返回带 audit 的结果数组。
 * 任一分录外币三栏超容差即抛错（整张凭证不通过），与 validateVoucher 的"全部通过"语义一致。
 */
export function checkFxEntries(
  entries: readonly FxEntry[],
  bookCurrency: string,
  toleranceBp = 10,
): FxEntryCheck[] {
  return entries.map((e) => checkFxEntry(e, bookCurrency, toleranceBp));
}
