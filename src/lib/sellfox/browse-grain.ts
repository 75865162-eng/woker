/**
 * 销量统计的时间粒度（grain）纯函数。
 *
 * 设计要点（与赛狐 1:1 复刻规划 §2.4 / §9.2 对齐）：
 * - day 保持逐日，不改变任何现有行为；
 * - week 以「所在 ISO 周的周一」为桶 key，month 以「月初」为桶 key。
 *   两种 key 都是合法 YYYY-MM-DD，前端沿用 new Date(key).getUTCDay() 解析即可，
 *   且周一的自然日期天然满足 IYYY-IW「跨年不串周」要求（同一 ISO 周只有一个周一）。
 * - 分桶聚合沿用现有 trend/average7 口径：桶内任一业务日缺值则桶值为 null，
 *   绝不把「未知/未采集」当作 0（禁用 COALESCE(...,0)）。
 *
 * 本模块不依赖数据库，也不 decode 任何业务 payload，纯粹的日期/数值变换，
 * 可用构造日期完整单测（与「猜字段」无关）。
 */

export type SellfoxGrain = "day" | "week" | "month";

export function sellfoxGrain(value: string | null | undefined): SellfoxGrain {
  return value === "week" || value === "month" ? value : "day";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 取该日期所在 ISO 周的周一（UTC）。跨年周天然落在唯一自然日上，不串周。 */
export function sellfoxIsoMonday(date: string): string {
  if (!ISO_DATE.test(date)) return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/** 桶 key：day=原日期；week=ISO 周一；month=月初。全部为合法 YYYY-MM-DD。 */
export function sellfoxBucketKey(date: string, grain: SellfoxGrain): string {
  if (grain === "week") return sellfoxIsoMonday(date);
  if (grain === "month") return `${date.slice(0, 7)}-01`;
  return date;
}

export type SellfoxRegrouped = {
  /** 有序、去重的桶 key 列表（升序），前端据此展开 day: 列。 */
  buckets: string[];
  /** 桶 key → 值；桶内任一业务日缺值则为 null。 */
  daily: Record<string, number | null>;
};

/**
 * 把逐日 daily 按 grain 重分桶。
 * @param daily 逐日值（SQL 日矩阵返回的 JSONB），值可能为 number/string/null。
 * @param sourceDates 查询范围内的完整逐日日期（决定桶内应有哪些业务日）。
 * @param grain 粒度。
 *
 * 口径：仅当桶内「每一个应出现的业务日」在 daily 中都有非 null 值时才求和；
 * 否则该桶为 null（缺日不补零）。day 粒度直接返回原值，零改动。
 */
export function regroupSellfoxDaily(
  daily: Record<string, unknown> | null | undefined,
  sourceDates: string[],
  grain: SellfoxGrain,
): SellfoxRegrouped {
  if (grain === "day") {
    const out: Record<string, number | null> = {};
    for (const date of sourceDates) out[date] = toNullableNumber(daily?.[date]);
    return { buckets: [...sourceDates], daily: out };
  }
  const grouped = new Map<string, string[]>();
  for (const date of sourceDates) {
    const key = sellfoxBucketKey(date, grain);
    const list = grouped.get(key) ?? [];
    list.push(date);
    grouped.set(key, list);
  }
  const buckets = [...grouped.keys()].sort();
  const out: Record<string, number | null> = {};
  for (const key of buckets) {
    const dates = grouped.get(key)!;
    const values = dates.map(date => toNullableNumber(daily?.[date]));
    out[key] = values.every(v => v != null)
      ? values.reduce<number>((sum, v) => sum + (v as number), 0)
      : null;
  }
  return { buckets, daily: out };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * summary.daily 的分桶：值为 { value, entities } 结构。
 * value 按桶内逐日求和（缺任一业务日则 null，不补零）；
 * entities 取桶内各日最大值（表示这个桶里有多少商品当日有快照，跨日不重复累加商品数）。
 */
export function regroupSellfoxSummaryDaily(
  daily: Record<string, { value: number | null; entities: number }> | null | undefined,
  sourceDates: string[],
  grain: SellfoxGrain,
): Record<string, { value: number | null; entities: number }> {
  if (grain === "day") return { ...(daily ?? {}) };
  const grouped = new Map<string, string[]>();
  for (const date of sourceDates) {
    const key = sellfoxBucketKey(date, grain);
    const list = grouped.get(key) ?? [];
    list.push(date);
    grouped.set(key, list);
  }
  const out: Record<string, { value: number | null; entities: number }> = {};
  for (const [key, dates] of grouped) {
    const values = dates.map(date => toNullableNumber(daily?.[date]?.value));
    const entities = dates.map(date => {
      const n = toNullableNumber(daily?.[date]?.entities);
      return n ?? 0;
    });
    out[key] = {
      value: values.every(v => v != null) ? values.reduce<number>((sum, v) => sum + (v as number), 0) : null,
      entities: Math.max(0, ...entities),
    };
  }
  return out;
}

/**
 * 星期分布列：仅 grain=day 且业务日数 ≤ maxDays 时生成。
 * 返回 { key: 'dow0'…'dow6', value }，缺任一该星期业务日则为 null（不补零）。
 * dow 取 UTC getUTCDay：0=周日 … 6=周六。
 */
export function sellfoxWeekdayColumns(
  daily: Record<string, unknown> | null | undefined,
  sourceDates: string[],
  grain: SellfoxGrain,
  maxDays = 62,
): Record<string, number | null> | null {
  if (grain !== "day" || sourceDates.length === 0 || sourceDates.length > maxDays) return null;
  const grouped = new Map<number, string[]>();
  for (const date of sourceDates) {
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getUTCDay();
    const list = grouped.get(dow) ?? [];
    list.push(date);
    grouped.set(dow, list);
  }
  const out: Record<string, number | null> = {};
  for (let dow = 0; dow <= 6; dow++) {
    const dates = grouped.get(dow);
    if (!dates) { out[`dow${dow}`] = null; continue; }
    const values = dates.map(date => toNullableNumber(daily?.[date]));
    out[`dow${dow}`] = values.every(v => v != null)
      ? values.reduce<number>((sum, v) => sum + (v as number), 0)
      : null;
  }
  return out;
}
