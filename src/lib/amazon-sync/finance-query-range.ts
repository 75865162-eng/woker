import { SyncInputError } from "./policy";

/** UTC bounds use [fromTimestamp, toTimestamp); day bounds retain inclusive to. */
export function financeQueryRange(params: URLSearchParams): { gte?: Date; lt?: Date } {
  const exact = params.has("fromTimestamp") || params.has("toTimestamp");
  if (exact && (params.get("from") || params.get("to"))) throw new SyncInputError("财务日期与精确时间范围不能同时使用。");
  const range: { gte?: Date; lt?: Date } = {};
  for (const key of exact ? ["fromTimestamp", "toTimestamp"] : ["from", "to"]) {
    const value = params.get(key);
    if (value === null || !exact && value === "") continue;
    const stamp = Date.parse(value);
    const date = new Date(stamp);
    if (exact) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(stamp)
        || date.toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) throw new SyncInputError("财务精确时间须为有效 UTC ISO 时间（Z，秒或毫秒精度）。");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(stamp) || date.toISOString().slice(0, 10) !== value) throw new SyncInputError("财务日期格式无效。");
    if (key === "from" || key === "fromTimestamp") range.gte = date;
    else range.lt = exact ? date : new Date(stamp + 86400000);
  }
  if (range.gte && range.lt && range.gte >= range.lt) throw new SyncInputError("财务日期范围无效。");
  return range;
}
