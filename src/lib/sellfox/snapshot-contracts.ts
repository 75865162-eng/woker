import { SellfoxSyncInputError } from "@/lib/sellfox/sync-contract";
type Row = Record<string, unknown>;
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SellfoxSyncInputError("赛狐快照响应记录无效。");
  return value as Row;
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numeric(value: unknown, integer: boolean) {
  if (value === null || value === "") return null;
  if ((typeof value !== "string" && typeof value !== "number") || !Number.isFinite(Number(value)) || (integer && !Number.isSafeInteger(Number(value)))) throw new SellfoxSyncInputError("赛狐快照包含无效数量或金额。");
  return Number(value);
}
export function sellfoxSnapshotPage(payload: unknown, pageNo: number) {
  const page = record(payload);
  if (!Array.isArray(page.rows) || page.pageNo !== pageNo || page.pageSize !== 100 || !Number.isSafeInteger(page.totalPage) || Number(page.totalPage) < 0 || !Number.isSafeInteger(page.totalSize) || Number(page.totalSize) < 0 || Number(page.totalPage) !== Math.ceil(Number(page.totalSize) / 100)) throw new SellfoxSyncInputError("赛狐快照分页结构无效或不完整。");
  if (page.rows.length > 100 || (page.rows.length && page.totalSize === 0) || pageNo > Math.max(1, Number(page.totalPage))) throw new SellfoxSyncInputError("赛狐快照页码或总数不一致。");
  const expectedRows = Math.max(0, Math.min(100, Number(page.totalSize) - (pageNo - 1) * 100));
  if (page.rows.length !== expectedRows) throw new SellfoxSyncInputError("赛狐快照分页记录数与总数不一致，未标记完整。");
  return { rows: page.rows.map(record), totalPages: Number(page.totalPage) };
}
export function sellfoxInventoryRow(value: unknown, shopExternalId: string) {
  const row = record(value);
  if (row.shopId !== shopExternalId) throw new SellfoxSyncInputError("库存响应店铺归属不匹配，已拒绝写入。");
  const sourceKey = text(row.id); const msku = text(row.sku); const asin = text(row.asin);
  if (!sourceKey || !msku || !asin) throw new SellfoxSyncInputError("库存响应缺少稳定商品身份。");
  if (!("available" in row)) throw new SellfoxSyncInputError("库存响应缺少可售量字段。");
  return { sourceKey, sku: text(row.commoditySku), msku, asin, fnsku: text(row.fnSku), quantity: numeric(row.available, true), payload: row };
}
function strings(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new SellfoxSyncInputError("销量响应商品身份列表无效。");
  return value.map((item) => (item as string).trim());
}
export function sellfoxSalesRow(value: unknown, shopExternalId: string, reportDate: string, metric: "productNum" | "salePrice" | "orderNum") {
  // Real historical MSKU reports can have skus:null (no internal SKU pairing).
  // shopIds/mskus remain required; do not manufacture an internal SKU from MSKU.
  const row = record(value); const shops = strings(row.shopIds); const mskus = strings(row.mskus); const asins = strings(row.asins); const skus = row.skus === null ? [] : strings(row.skus);
  if (shops.length !== 1 || shops[0] !== shopExternalId) throw new SellfoxSyncInputError("销量响应店铺归属不匹配，已拒绝写入。");
  if (mskus.length !== 1 || asins.length > 1 || skus.length > 1) throw new SellfoxSyncInputError("销量响应不是唯一 MSKU 维度。");
  if (!Array.isArray(row.productSaleDayOpenVo) || row.productSaleDayOpenVo.length !== 1) throw new SellfoxSyncInputError("销量单日报表缺少唯一业务日。");
  const day = record(row.productSaleDayOpenVo[0]);
  if (day.day !== reportDate || (!(metric in day) && metric !== "orderNum") || !text(day.currency)) throw new SellfoxSyncInputError("销量日期、币种或指标与请求不匹配。");
  return { sourceKey: mskus[0], msku: mskus[0], asin: asins[0] ?? "", sku: skus[0] ?? "", currency: text(day.currency), value: numeric(day[metric] ?? null, metric !== "salePrice"), payload: row };
}
