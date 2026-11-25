/**
 * 费用解析规则库（报告2 P2-4）——费用解析从硬编码升级为可配置规则。
 *
 * 目标：借鉴赛狐"1000+ 费用解析"思路，把「目标列 ← 源表头别名 + 变换 + 优先级」
 * 抽象为可序列化规则，新增报告表头无需改代码即可解析（规则可落库，本模块只做纯解析内核）。
 *
 * 红线：
 * - 空值不补零：源空字符串/null/缺失返回 null（沿用 ExtractedField 口径）。
 * - 保真 + 来源标记：返回 { value, matchedKey, ruleKey }，可审计取值来自哪条规则的哪个源键。
 * - transform 只允许白名单（number/positiveNumber/signedAmount/trim/upper/lower/date），
 *   杜绝任意代码执行；变换失败返回 null 而非臆造（可配置 strict 抛错）。
 * - 高 priority 优先；同 priority 按规则声明顺序；别名按 priority 内顺序。
 * - 纯函数、零 IO。
 */

export class FeeParseRuleError extends Error {}
function fail(message: string): never { throw new FeeParseRuleError(message); }

export const TRANSFORMS = ["raw", "trim", "upper", "lower", "number", "positiveNumber", "signedAmount", "date"] as const;
export type Transform = (typeof TRANSFORMS)[number];

export type FeeParseRule = {
  /** 规则唯一键（落库主键）。 */
  key: string;
  /** 解析结果写入的目标列/规范字段。 */
  targetColumn: string;
  /** 源表头别名（按优先级顺序匹配）。 */
  aliases: string[];
  /** 值变换（默认 raw 保真）。 */
  transform: Transform;
  /** 规则优先级，数值大者优先；默认 0。 */
  priority?: number;
  enabled?: boolean;
};

export type ParsedFee = {
  /** 变换后的值（number 为数字，其余为字符串）；源缺失/变换失败为 null。 */
  value: string | number | null;
  /** 命中的源键（审计用）。 */
  matchedKey: string | null;
  /** 命中的规则键（审计用）。 */
  ruleKey: string | null;
  /** 源端显式空值标记。 */
  explicitlyEmpty: boolean;
};

type RawFields = Record<string, unknown> | null | undefined;

/** 归一化键：小写 + 去分隔符，兼容表头大小写/下划线/连字符差异。 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-./]/g, "");
}

function normalizedIndex(fields: RawFields): Map<string, string> {
  const idx = new Map<string, string>();
  if (!fields || typeof fields !== "object") return idx;
  for (const key of Object.keys(fields)) {
    const nk = normalizeKey(key);
    if (!idx.has(nk)) idx.set(nk, key); // 首次出现优先
  }
  return idx;
}

function applyTransform(transform: Transform, raw: string): string | number | null {
  switch (transform) {
    case "raw": return raw;
    case "trim": return raw.trim();
    case "upper": return raw.trim().toUpperCase();
    case "lower": return raw.trim().toLowerCase();
    case "number": {
      if (!/^-?\d+(?:\.\d+)?$/.test(raw.trim())) return null;
      const n = Number(raw.trim());
      return Number.isFinite(n) ? n : null;
    }
    case "positiveNumber": {
      if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) return null;
      const n = Number(raw.trim());
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    case "signedAmount": {
      // 保真返回规范化字符串（去千分位/空格），金额精度由展示层处理
      const cleaned = raw.replace(/[,\s]/g, "");
      return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : null;
    }
    case "date": {
      const t = raw.trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
    }
    default: fail(`未知变换：${transform}`);
  }
}

/** 校验规则库：键唯一、目标列非空、别名非空、transform 白名单、priority 整数。 */
export function validateRules(rules: readonly FeeParseRule[]): void {
  const keys = new Set<string>();
  for (const rule of rules) {
    if (typeof rule.key !== "string" || !rule.key) fail("规则键不能为空。");
    if (keys.has(rule.key)) fail(`规则键重复：${rule.key}`);
    keys.add(rule.key);
    if (typeof rule.targetColumn !== "string" || !rule.targetColumn) fail(`规则 ${rule.key} 目标列不能为空。`);
    if (!Array.isArray(rule.aliases) || rule.aliases.length === 0) fail(`规则 ${rule.key} 须提供至少一个别名。`);
    if (!TRANSFORMS.includes(rule.transform)) fail(`规则 ${rule.key} 变换非法：${rule.transform}`);
    if (rule.priority !== undefined && !Number.isSafeInteger(rule.priority)) fail(`规则 ${rule.key} 优先级须为整数。`);
  }
}

/** 按 priority 降序、声明顺序升序排序（不改原数组）。 */
export function sortRules(rules: readonly FeeParseRule[]): FeeParseRule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false)
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index)
    .map(({ rule }) => rule);
}

/**
 * 用规则库解析一行原始字段：返回 targetColumn → ParsedFee 的映射。
 * 每条规则独立匹配，缺值显式 null；strict=true 时变换失败抛错（默认宽松返回 null）。
 */
export function parseFeesWithRules(
  fields: RawFields,
  rules: readonly FeeParseRule[],
  options: { strict?: boolean } = {},
): Record<string, ParsedFee> {
  validateRules(rules);
  const idx = normalizedIndex(fields);
  const ordered = sortRules(rules);
  const out: Record<string, ParsedFee> = {};

  for (const rule of ordered) {
    // 若已有更高优先级规则命中同一目标列，跳过低优先级
    if (out[rule.targetColumn]?.ruleKey) continue;
    let matchedKey: string | null = null;
    let matchedRaw: unknown;
    for (const alias of rule.aliases) {
      const actual = idx.get(normalizeKey(alias));
      if (actual !== undefined) { matchedKey = actual; matchedRaw = fields![actual]; break; }
    }
    if (matchedKey === null) {
      out[rule.targetColumn] = { value: null, matchedKey: null, ruleKey: null, explicitlyEmpty: false };
      continue;
    }
    if (matchedRaw === null || matchedRaw === undefined || String(matchedRaw).trim() === "") {
      out[rule.targetColumn] = { value: null, matchedKey, ruleKey: rule.key, explicitlyEmpty: true };
      continue;
    }
    const value = applyTransform(rule.transform, String(matchedRaw));
    if (value === null && options.strict) fail(`规则 ${rule.key} 变换失败：${String(matchedRaw)}`);
    out[rule.targetColumn] = { value, matchedKey, ruleKey: rule.key, explicitlyEmpty: false };
  }
  return out;
}
