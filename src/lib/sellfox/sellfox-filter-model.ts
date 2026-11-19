/**
 * 赛狐筛选条件模型（增量基础设施，不推翻现有 browse-filters 组件）。
 *
 * 目标（对齐 1:1 复刻规划 §2.4 / §9.2）：
 * - 服务端 field → { column, type } 白名单，前端不得传裸列名；非法 field 拒绝。
 * - 批量粘贴：按 逗号/分号/换行/空格 切分，去空、修剪、去重，上限 500，
 *   超限明确报错（不静默丢弃，以便 UI 提示用户）。
 * - URL 可分享：条件模型可逆序列化（base64url），解码失败回落默认，不 500。
 *
 * 本模块为纯函数，不依赖数据库/业务 payload，可用构造输入完整单测。
 * 字段白名单只声明「允许投影的键」，不读取也不猜任何 payload 值。
 */

export const SELLFOX_FILTER_VALUES_MAX = 500;

/** 条件操作符：精确等于 / 包含 / 数值区间等由消费方解释。 */
export type FilterOp = "eq" | "contains" | "in" | "between";

export interface FilterCondition {
  field: string;
  op: FilterOp;
  values: string[];
}

export interface FilterFieldSpec {
  column: string;   // 允许的真实列/键名（服务端持有，前端不可见）
  type: "text" | "number" | "date" | "enum";
  ops: FilterOp[];
}

/**
 * 各域允许的筛选字段白名单。column 只映射到已存在的 typed 字段，
 * 不引入新字段、不 decode payload。新增筛选须在此显式登记。
 */
export const SELLFOX_FILTER_FIELDS: Record<string, Record<string, FilterFieldSpec>> = {
  sales: {
    asin: { column: "asin", type: "text", ops: ["eq", "contains", "in"] },
    msku: { column: "msku", type: "text", ops: ["eq", "contains", "in"] },
    sku: { column: "sku", type: "text", ops: ["eq", "contains", "in"] },
    parentAsin: { column: "parentAsin", type: "text", ops: ["eq", "contains", "in"] },
    store: { column: "storeId", type: "text", ops: ["eq", "in"] },
    currency: { column: "currency", type: "enum", ops: ["eq", "in"] },
  },
  listings: {
    asin: { column: "asin", type: "text", ops: ["eq", "contains", "in"] },
    msku: { column: "msku", type: "text", ops: ["eq", "contains", "in"] },
    sku: { column: "sku", type: "text", ops: ["eq", "contains", "in"] },
    parentAsin: { column: "parentAsin", type: "text", ops: ["eq", "contains", "in"] },
    brand: { column: "brand", type: "text", ops: ["eq", "contains", "in"] },
    status: { column: "status", type: "enum", ops: ["eq", "in"] },
  },
};

export class SellfoxFilterError extends Error {
  constructor(message: string) { super(message); }
}

/** 批量粘贴切分：逗号/分号/换行/空格；去空、修剪、去重、保序；超限抛错（不静默丢）。 */
export function parseSellfoxPastedValues(input: string | null | undefined, max = SELLFOX_FILTER_VALUES_MAX): string[] {
  if (!input) return [];
  const parts = input.split(/[,;\n\r\t ]+/).map(v => v.trim()).filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length > max) throw new SellfoxFilterError(`一次最多粘贴 ${max} 个值，当前 ${unique.length} 个，请分批筛选。`);
  return unique;
}

/**
 * 校验单条条件：field 必须在白名单，op 必须被该字段允许，values 经批量解析。
 * 返回规范化后的条件（values 去空去重、上限校验），供服务端安全消费。
 */
export function normalizeSellfoxCondition(
  domain: string,
  raw: { field?: unknown; op?: unknown; values?: unknown },
): FilterCondition {
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  const specs = SELLFOX_FILTER_FIELDS[domain];
  const spec = specs?.[field];
  if (!spec) throw new SellfoxFilterError(`筛选字段 ${field || "(空)"} 不在 ${domain} 域允许列表。`);
  const op = typeof raw.op === "string" ? raw.op as FilterOp : "eq";
  if (!spec.ops.includes(op)) throw new SellfoxFilterError(`筛选字段 ${field} 不支持操作符 ${op || "(空)"}。`);
  const values = Array.isArray(raw.values)
    ? [...new Set(raw.values.map(v => String(v).trim()).filter(Boolean))]
    : parseSellfoxPastedValues(typeof raw.values === "string" ? raw.values : "");
  if (values.length === 0) throw new SellfoxFilterError(`筛选字段 ${field} 缺少值。`);
  if (values.length > SELLFOX_FILTER_VALUES_MAX) throw new SellfoxFilterError(`一次最多 ${SELLFOX_FILTER_VALUES_MAX} 个值。`);
  return { field, op, values };
}

/** 服务端只取白名单里的 column/type；非法 field 返回 null，供调用方决定拒绝。 */
export function resolveSellfoxFilterField(domain: string, field: string): FilterFieldSpec | null {
  return SELLFOX_FILTER_FIELDS[domain]?.[field] ?? null;
}
