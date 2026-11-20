/**
 * 赛狐工作台行内动作（M3）：ASIN 外链、趋势数据、跳转链接。
 *
 * 纯函数，无请求/无副作用。数据源是工作台已加载的真实行，不新增接口、不猜字段、不造数。
 * 五条铁律：无 ASIN 禁用；趋势缺日不补零；跳转带全当前筛选（同上下文下钻）；金额按币种。
 */

const ASIN_RE = /^[A-Z0-9]{10}$/;

/** 合法 ASIN → amazon.com/dp 外链；非法/空 → null（调用方据此禁用，不跳空链）。 */
export function sellfoxAsinHref(asin: unknown): string | null {
  const value = typeof asin === "string" ? asin.trim().toUpperCase() : "";
  return ASIN_RE.test(value) ? `https://www.amazon.com/dp/${value}` : null;
}

export type TrendPoint = { date: string; value: number | null };

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 从工作台行的日矩阵取趋势点（真实值，缺日保留 null，不补零）。
 * 优先读 `day:YYYY-MM-DD` 列（已按 grain 重采样），否则读 dailyQuantity 映射。
 */
export function sellfoxRowTrend(
  row: Record<string, unknown>,
  dates: string[],
): TrendPoint[] {
  const daily = row.dailyQuantity && typeof row.dailyQuantity === "object" && !Array.isArray(row.dailyQuantity)
    ? row.dailyQuantity as Record<string, unknown>
    : null;
  return dates.map((date) => {
    const key = `day:${date}`;
    const raw = key in row ? row[key] : daily?.[date];
    return { date, value: toNumber(raw) };
  });
}

/** 均值：仅对非 null 的真实点求平均；无真实点为 null（不拿缺失当 0）。 */
export function sellfoxTrendAverage(points: TrendPoint[], days: number): number | null {
  const window = points.slice(-days);
  const values = window.map((p) => p.value).filter((v): v is number => v != null);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 环比：(最新 - 上一) / 上一；上一为 null/0 或最新为 null 时返回 null（除零保护）。 */
export function sellfoxTrendChange(points: TrendPoint[]): { latest: number | null; previous: number | null; ratio: number | null } {
  const latest = points.at(-1)?.value ?? null;
  const previous = points.at(-2)?.value ?? null;
  const ratio = latest != null && previous != null && previous !== 0 ? (latest - previous) / previous : null;
  return { latest, previous, ratio };
}

export type DrillTarget = "listings" | "insight" | "trend";

/**
 * 构造下钻链接：目标页 + 当前筛选上下文（filter-codec 编码的查询串）。
 * 只透传白名单内的筛选参数，不拼接用户可控的任意键（围栏与同上下文下钻）。
 */
const DRILL_PATHS: Record<DrillTarget, string> = {
  listings: "/sellfox/listings",
  insight: "/sellfox/insight",
  trend: "/sellfox/sales",
};
const DRILL_KEYS = [
  "from", "to", "site", "sites", "shopExternalId", "shopExternalIds", "salesperson", "salespersons",
  "fulfillment", "productTag", "currency", "grain", "metric", "dimension", "searchType", "exactMatch",
] as const;

export function sellfoxDrillHref(
  target: DrillTarget,
  current: URLSearchParams,
  entity: { asin?: unknown; msku?: unknown },
): string {
  const params = new URLSearchParams();
  for (const key of DRILL_KEYS) {
    const values = current.getAll(key);
    for (const value of values) if (value) params.append(key, value);
  }
  const asin = typeof entity.asin === "string" ? entity.asin.trim() : "";
  const msku = typeof entity.msku === "string" ? entity.msku.trim() : "";
  if (asin) params.set("asin", asin);
  if (msku) params.set("msku", msku);
  const query = params.toString();
  return query ? `${DRILL_PATHS[target]}?${query}` : DRILL_PATHS[target];
}
