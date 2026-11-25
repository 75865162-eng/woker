/**
 * 统一利润公式引擎（报告3 P2-1 / 报告2 P1-2）——可配置、可审计、可下钻。
 *
 * 目标公式（默认）：
 *   净利润 = 结算本金 − 平台费 − 采购成本(含/不含税) − 头程 − 广告费 − 退货货损 − VAT − 本地费用
 *
 * 红线：
 * - 复用 report-formula 的安全表达式求值（仅十进制常量 + [项键] + 四则 + 括号，禁任意代码）。
 * - 每个利润项保留原币与来源；currency 必须等于账套/汇总币种，绝不跨币种混算。
 * - 未配置或无来源（amount=null / source 空）的项进入 pendingSources 显式标注，
 *   返回 INCOMPLETE 且 netProfit=null，绝不按 0 扣减（避免"看似精确实则错误"）。
 * - 纯函数、零 IO、BigInt 6 位定点；不写库、不过账。
 */

import { evaluateReportFormula, reportFormulaReferences } from "./report-formula";
import { amountUnits, unitsAmount } from "./open-item-rules";

export class ProfitFormulaError extends Error {}

/** 默认净利润表达式：8 个标准项。项键即 [引用名]。 */
export const DEFAULT_PROFIT_EXPRESSION =
  "[principal]-[platformFee]-[procurementCost]-[firstMile]-[ads]-[returns]-[vat]-[local]";

/** 标准利润项语义目录（用于看板展示与缺项提示，非强制齐全）。 */
export const STANDARD_PROFIT_KEYS = [
  "principal", "platformFee", "procurementCost", "firstMile", "ads", "returns", "vat", "local",
] as const;
export type StandardProfitKey = (typeof STANDARD_PROFIT_KEYS)[number];

export type ProfitItem = {
  /** 项键，对应公式中的 [key]。 */
  key: string;
  /** 展示名。 */
  label: string;
  /** 原币金额（6 位定点十进制字符串）；null = 未配置/无来源。 */
  amount: string | null;
  /** 该项币种，必须等于 config.currency。 */
  currency: string;
  /** 数据来源标识（报告/账期/凭证）；空视为无来源。 */
  source: string;
};

export type ProfitFormulaConfig = {
  organizationId: string;
  workspaceId: string;
  /** 汇总币种（账套本位币或指定展示币种）。 */
  currency: string;
  /** 公式版本，随配置变更递增，进入审计输出。 */
  version: number;
  /** 表达式；默认 DEFAULT_PROFIT_EXPRESSION。 */
  expression: string;
  items: readonly ProfitItem[];
};

export type ProfitBreakdownItem = {
  key: string;
  label: string;
  amount: string | null;
  currency: string;
  source: string;
  /** 是否参与本次求值。 */
  included: boolean;
};

export type ProfitResult = {
  organizationId: string;
  workspaceId: string;
  currency: string;
  version: number;
  expression: string;
  /** READY=全部引用项就绪并已求值；INCOMPLETE=存在未配置/无来源项，netProfit 为 null。 */
  status: "READY" | "INCOMPLETE";
  /** 净利润（6 位定点字符串）；INCOMPLETE 时为 null，绝不补零。 */
  netProfit: string | null;
  breakdown: ProfitBreakdownItem[];
  /** 缺失/无来源的项键列表（显式标注，供 UI 提示与补录）。 */
  pendingSources: string[];
};

function fail(message: string): never {
  throw new ProfitFormulaError(message);
}

/**
 * 计算净利润。任何非法公式、跨币种、引用未定义项均 fail-closed 抛错；
 * 存在未配置/无来源项时返回 INCOMPLETE（netProfit=null），而不是用 0 顶替。
 */
export function computeProfit(config: ProfitFormulaConfig): ProfitResult {
  if (typeof config.organizationId !== "string" || !config.organizationId) fail("organizationId 不能为空。");
  if (typeof config.workspaceId !== "string" || !config.workspaceId) fail("workspaceId 不能为空。");
  if (!/^[A-Z]{3}$/.test(config.currency)) fail("汇总币种须为三位大写字母。");
  if (!Number.isSafeInteger(config.version) || config.version < 1) fail("公式版本须为正整数。");
  const expression = config.expression?.trim() ? config.expression : DEFAULT_PROFIT_EXPRESSION;

  // 项键唯一性 + 币种一致性 + 来源校验
  const byKey = new Map<string, ProfitItem>();
  for (const item of config.items) {
    if (typeof item.key !== "string" || !item.key) fail("利润项键不能为空。");
    if (byKey.has(item.key)) fail(`利润项键重复：${item.key}`);
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(item.key)) fail(`利润项键含非法字符：${item.key}`);
    if (item.currency !== config.currency) fail(`利润项 ${item.key} 币种 ${item.currency} 与汇总币种 ${config.currency} 不一致，禁止跨币种混算。`);
    byKey.set(item.key, item);
  }

  // 公式引用必须全部在 items 中有定义，否则 fail-closed（不静默当 0）
  let refs: string[];
  try {
    refs = reportFormulaReferences(expression);
  } catch (e) {
    fail(`利润公式非法：${(e as Error).message}`);
  }
  for (const ref of refs!) {
    if (!byKey.has(ref)) fail(`利润公式引用了未定义的项 [${ref}]。`);
  }
  if (refs!.length === 0) fail("利润公式须至少引用一个利润项。");

  // 缺失/无来源判定
  const pendingSources: string[] = [];
  for (const ref of refs!) {
    const item = byKey.get(ref)!;
    if (item.amount === null || typeof item.amount !== "string" || String(item.source ?? "").trim() === "") {
      pendingSources.push(ref);
    }
  }
  const breakdown: ProfitBreakdownItem[] = refs!.map(ref => {
    const item = byKey.get(ref)!;
    return {
      key: item.key, label: item.label, amount: item.amount, currency: item.currency, source: item.source,
      included: !pendingSources.includes(ref),
    };
  });

  const base = {
    organizationId: config.organizationId, workspaceId: config.workspaceId,
    currency: config.currency, version: config.version, expression,
    breakdown, pendingSources: [...pendingSources].sort(),
  };

  if (pendingSources.length > 0) {
    return { ...base, status: "INCOMPLETE", netProfit: null };
  }

  // 全部就绪：用安全求值器计算，数值均为 6 位定点 bigint
  const resolve = (ref: string) => {
    const item = byKey.get(ref)!;
    try {
      return amountUnits(item.amount as string);
    } catch (e) {
      fail(`利润项 ${ref} 金额非法：${(e as Error).message}`);
    }
  };
  let netProfitUnits: bigint;
  try {
    netProfitUnits = evaluateReportFormula(expression, resolve);
  } catch (e) {
    fail(`利润公式求值失败：${(e as Error).message}`);
  }
  return { ...base, status: "READY", netProfit: unitsAmount(netProfitUnits!) };
}

/** 便捷：标准 8 项共价（全部就绪）的最短构造校验，供调用层预检。 */
export function missingStandardKeys(items: readonly ProfitItem[]): StandardProfitKey[] {
  const present = new Set(items.filter(i => i.amount !== null && String(i.source ?? "").trim()).map(i => i.key));
  return STANDARD_PROFIT_KEYS.filter(k => !present.has(k));
}
