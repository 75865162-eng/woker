import { businessDate, shiftDate } from "./date-range";
import { SyncInputError } from "./policy";

/** Filters a stored observation window; it never implies Amazon historical inventory support. */
type Match = { contains: string; mode: "insensitive" };
type DateWindow = { gte?: Date; lt?: Date };
export type SnapshotRowFilters = { sellerSku?: Match; asin?: Match; OR?: Array<{ sellerSku?: Match; asin?: Match }>; capturedAt?: DateWindow; sourceUpdatedAt?: DateWindow };
export function snapshotRowFilters(params: URLSearchParams): SnapshotRowFilters {
  const text = (name: string) => { const value = params.get(name)?.trim(); if (value && value.length > 200) throw new SyncInputError("快照查询条件过长。"); return value; };
  const field = params.get("dateField") ?? "capturedAt";
  if (field !== "capturedAt" && field !== "sourceUpdatedAt") throw new SyncInputError("快照日期字段无效。");
  const from = params.get("from") ? businessDate(params.get("from")) : undefined, to = params.get("to") ? businessDate(params.get("to")) : undefined;
  if (from && to && from > to) throw new SyncInputError("快照日期范围倒置。");
  const sku = text("sku"), asin = text("asin"), keyword = text("keyword");
  return {
    ...(sku ? { sellerSku: { contains: sku, mode: "insensitive" as const } } : {}),
    ...(asin ? { asin: { contains: asin, mode: "insensitive" as const } } : {}),
    ...(keyword ? { OR: [{ sellerSku: { contains: keyword, mode: "insensitive" as const } }, { asin: { contains: keyword, mode: "insensitive" as const } }] } : {}),
    ...(from || to ? { [field]: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(shiftDate(to, 1)) } : {}) } } : {}),
  };
}
