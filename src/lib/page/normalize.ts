/**
 * 后端响应归一化 + 展示格式化。
 *
 * Wimoor 原系统各接口的返回壳并不统一（records / rows / list / data.records / 裸数组），
 * 原前端在每个 .vue 里各写一套兼容。这里收敛成一处，供统一表格与统计区消费。
 */

export type NormalizedList<T> = {
  records: T[];
  total: number;
  summary?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTotal(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readSummary(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** 兼容 {records,total} / {data:{records,total}} / {rows,total} / {list,total} / 裸数组。 */
export function normalizeList<T>(payload: unknown): NormalizedList<T> {
  if (Array.isArray(payload)) {
    return { records: payload as T[], total: payload.length };
  }
  if (!isRecord(payload)) return { records: [], total: 0 };

  const nested = isRecord(payload.data) ? payload.data : null;
  const containers: Record<string, unknown>[] = [payload];
  if (nested) containers.push(nested);
  if (isRecord(payload.result)) containers.push(payload.result);

  for (const container of containers) {
    for (const key of ["records", "rows", "list", "items", "data"]) {
      const candidate = container[key];
      if (Array.isArray(candidate)) {
        const totalValue = container.total ?? container.count ?? container.totalCount;
        const summary = readSummary(container.summary) ?? readSummary(container.aggregates);
        return { records: candidate as T[], total: toTotal(totalValue, candidate.length), ...(summary ? { summary } : {}) };
      }
    }
  }

  // 某些接口把明细放在 data.list / data.rows 里的同时把 total 放在最外层
  const nestedList = nested ? (nested.records ?? nested.rows ?? nested.list) : undefined;
  if (Array.isArray(nestedList)) {
    const summary = readSummary(payload.summary) ?? readSummary(nested?.summary);
    return {
      records: nestedList as T[],
      total: toTotal(payload.total ?? nested?.total, nestedList.length),
      ...(summary ? { summary } : {}),
    };
  }

  return { records: [], total: toTotal(payload.total, 0), ...(readSummary(payload.summary) ? { summary: readSummary(payload.summary) } : {}) };
}

const EMPTY = "-";

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/[,¥$€£\s%]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isRecord(value) && typeof value.toString === "function") {
    const text = String(value);
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fixed(value: number, fractionDigits: number): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** 金额：默认人民币，原系统金额列统一带千分位与 2 位小数。 */
export function formatAmount(value: unknown, currency = "¥"): string {
  const parsed = numeric(value);
  if (parsed === null) return EMPTY;
  return `${currency}${fixed(parsed, 2)}`;
}

export function formatNumber(value: unknown, fractionDigits = 0): string {
  const parsed = numeric(value);
  return parsed === null ? EMPTY : fixed(parsed, Math.min(6, Math.max(0, fractionDigits)));
}

/** 入参既可能是 0.1234，也可能是 12.34；超过 1 视为已是百分数。 */
export function formatPercent(value: unknown, fractionDigits = 2): string {
  const parsed = numeric(value);
  if (parsed === null) return EMPTY;
  const percent = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return `${fixed(percent, Math.min(6, Math.max(0, fractionDigits)))}%`;
}

export function formatDate(value: unknown, withTime = false): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (!withTime) return datePart;
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 空值统一显示 `-`，避免表格里出现 undefined / null / 空白。 */
export function displayValue(value: unknown, fallback = EMPTY): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value.trim() === "" ? fallback : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return formatDate(value, true);
  if (Array.isArray(value)) return value.length ? value.map((item) => displayValue(item, "")).filter(Boolean).join("、") || fallback : fallback;
  if (isRecord(value)) {
    for (const key of ["label", "name", "title", "text", "value"]) {
      if (key in value) return displayValue(value[key], fallback);
    }
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}
