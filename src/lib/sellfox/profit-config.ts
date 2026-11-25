/**
 * 利润参数配置层（报告2 P1-1 / 对齐 WIMOOR ProfitConfigCountry 23 参数）。
 *
 * 目标：按「店铺 × 国家」配置利润计算参数并版本化，参数变更留痕（DataChangeVersion），
 * 替代散落在公式里的硬编码。
 *
 * 红线：
 * - 参数是外部业务输入，缺省为 null（未配置），绝不臆造默认值；
 *   调用方若用未配置参数算利润，须由 profit-formula 的 pendingSources 机制显式拦截。
 * - 比率类参数（税率/费率）须为 [0,1] 区间；金额/月数类须非负；分摊枚举须合法。
 * - 纯函数、零 IO、BigInt-free（参数为标量），租户隔离字段必填。
 */

export class ProfitConfigError extends Error {}
function fail(message: string): never { throw new ProfitConfigError(message); }
function need(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} 不能为空。`);
  return value;
}

/** WIMOOR 23 参数的规范键（比率用 ratio 语义 [0,1]）。 */
export const PROFIT_PARAM_KEYS = [
  "taxRate", "vatRate", "gstRate", "corporateInRate", "costRate", "lostRate", "sellerRate",
  "storageFee", "logistics", "fbaMonth", "aMonth", "fenpeiType",
  "returnRate", "promotionRate", "commissionRate", "exchangeLossRate", "otherFeeRate",
  "localReturnTaxRate", "customsTaxRate", "inboundFee", "storageMonthFee", "settlementCycleDays", "roundingMode",
] as const;
export type ProfitParamKey = (typeof PROFIT_PARAM_KEYS)[number];

/** 比率类参数：值域 [0,1]。 */
export const RATIO_KEYS: ReadonlySet<ProfitParamKey> = new Set<ProfitParamKey>([
  "taxRate", "vatRate", "gstRate", "corporateInRate", "costRate", "lostRate", "sellerRate",
  "returnRate", "promotionRate", "commissionRate", "exchangeLossRate", "otherFeeRate",
  "localReturnTaxRate", "customsTaxRate",
]);
/** 非负数值类参数（金额/月数/天数）。 */
export const NONNEG_KEYS: ReadonlySet<ProfitParamKey> = new Set<ProfitParamKey>([
  "storageFee", "logistics", "fbaMonth", "aMonth", "inboundFee", "storageMonthFee", "settlementCycleDays",
]);
/** 枚举类参数。 */
export const ENUM_DOMAINS: Partial<Record<ProfitParamKey, readonly string[]>> = {
  fenpeiType: ["BY_SALES", "BY_QTY", "EQUAL", "CUSTOM"],
  roundingMode: ["HALF_UP", "HALF_EVEN", "DOWN"],
};

export type ProfitConfigValues = Partial<Record<ProfitParamKey, number | string | null>>;

export type ProfitConfigInput = {
  organizationId: string;
  workspaceId: string;
  shopId: string;
  /** ISO 国家码（如 US/DE/GB）；ALL 表示店铺默认。 */
  country: string;
  isDefault: boolean;
  /** 配置版本号（正整数），随每次变更递增。 */
  version: number;
  values: ProfitConfigValues;
  /** 变更依据（审计留痕）。 */
  changeReference: string;
};

export type ProfitConfigRecord = ProfitConfigInput & {
  /** DataChangeVersion 键：租户 + 店铺 + 国家 + 版本，唯一标识一次配置快照。 */
  changeKey: string;
  /** 已显式配置的参数键（值非 null）。 */
  configuredKeys: ProfitParamKey[];
  /** 未配置的参数键（显式标注，不补默认值）。 */
  missingKeys: ProfitParamKey[];
};

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 校验单个参数值；null/undefined 视为未配置（合法，不臆造）。 */
export function validateParam(key: ProfitParamKey, value: number | string | null | undefined): void {
  if (!PROFIT_PARAM_KEYS.includes(key)) fail(`未知利润参数：${key}`);
  if (value === null || value === undefined) return;
  if (RATIO_KEYS.has(key)) {
    if (!validNumber(value) || value < 0 || value > 1) fail(`参数 ${key} 须为 [0,1] 区间的比率。`);
    return;
  }
  if (NONNEG_KEYS.has(key)) {
    if (!validNumber(value) || value < 0) fail(`参数 ${key} 须为非负数值。`);
    return;
  }
  const domain = ENUM_DOMAINS[key];
  if (domain) {
    if (typeof value !== "string" || !domain.includes(value)) fail(`参数 ${key} 须为枚举值之一：${domain.join("/")}。`);
  }
}

/** 构建并校验一份店铺×国家利润配置快照。 */
export function buildProfitConfig(input: ProfitConfigInput): ProfitConfigRecord {
  need(input.organizationId, "organizationId");
  need(input.workspaceId, "workspaceId");
  need(input.shopId, "shopId");
  if (!/^[A-Z]{2,3}$/.test(input.country)) fail("country 须为 2-3 位大写国家码（或 ALL）。");
  if (!Number.isSafeInteger(input.version) || input.version < 1) fail("配置版本须为正整数。");
  if (typeof input.isDefault !== "boolean") fail("isDefault 须为布尔值。");
  need(input.changeReference, "变更依据");

  const configuredKeys: ProfitParamKey[] = [];
  const missingKeys: ProfitParamKey[] = [];
  for (const key of PROFIT_PARAM_KEYS) {
    const value = input.values[key];
    validateParam(key, value ?? null);
    if (value === null || value === undefined) missingKeys.push(key);
    else configuredKeys.push(key);
  }
  const changeKey = ["profitcfg", input.organizationId, input.workspaceId, input.shopId, input.country, String(input.version)].join("|");
  return { ...input, changeKey, configuredKeys, missingKeys };
}

/**
 * 解析店铺×国家配置的优先级：精确国家 > 店铺默认(ALL)。
 * 返回解析出的配置快照；未找到返回 null（不臆造默认配置）。
 */
export function resolveProfitConfig(
  country: string,
  configs: readonly ProfitConfigRecord[],
): ProfitConfigRecord | null {
  const exact = configs.find(c => c.country === country);
  if (exact) return exact;
  const shopDefault = configs.find(c => c.country === "ALL" && c.isDefault);
  return shopDefault ?? null;
}

/**
 * 合并两级配置为有效参数：精确国家覆盖店铺默认；缺失项保持 null（不补默认）。
 * 返回参数快照与仍缺失的键。
 */
export function effectiveProfitParams(resolved: ProfitConfigRecord | null, fallback: ProfitConfigRecord | null) {
  const out: ProfitConfigValues = {};
  for (const key of PROFIT_PARAM_KEYS) {
    const v = resolved?.values[key] ?? fallback?.values[key] ?? null;
    out[key] = v;
  }
  const missing = PROFIT_PARAM_KEYS.filter(k => out[k] === null || out[k] === undefined);
  return { params: out, missingKeys: missing };
}
