import { businessDate, shiftDate, type RequestedRange } from "./date-range";
export const salesTrafficReportType = "GET_SALES_AND_TRAFFIC_REPORT";
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("销售流量报告结构无效。"); return v as Record<string, unknown>; }
function count(v: unknown): number | null { if (v === undefined || v === null) return null; if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("报告计数无效。"); return v; }
export function parseSalesTraffic(value: unknown, range: RequestedRange, marketplaceId: string) {
  const root = record(value), specification = record(root.reportSpecification), options = record(specification.reportOptions);
  if (specification.reportType !== salesTrafficReportType || options.dateGranularity !== "DAY" || (options.asinGranularity !== "CHILD" && options.asinGranularity !== "SKU") || !Array.isArray(specification.marketplaceIds) || specification.marketplaceIds.length !== 1 || specification.marketplaceIds[0] !== marketplaceId) throw new Error("报告类型、站点或粒度与冻结任务不匹配。");
  // Report specification timestamps must match the requested API window.
  const start = String(specification.dataStartTime), end = String(specification.dataEndTime);
  const startMatches = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start === range.from : [range.startAt, `${range.from}T00:00:00Z`].some(expected => Date.parse(start) === Date.parse(expected));
  const endMatches = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end === range.to : [range.reportEndAt, `${range.to}T23:59:59Z`].some(expected => Date.parse(end) === Date.parse(expected));
  if (!startMatches || !endMatches) throw new Error("报告日期范围不匹配。");
  if (!Array.isArray(root.salesAndTrafficByDate) || root.salesAndTrafficByDate.length > 31) throw new Error("报告缺少逐日数据或超出范围。");
  const seen = new Set<string>();
  const rows = root.salesAndTrafficByDate.map(raw => {
    const row = record(raw), date = businessDate(row.date);
    if (date < range.from || date > range.to || seen.has(date)) throw new Error("报告存在越界或重复业务日期。");
    seen.add(date);
    const sales = record(row.salesByDate), traffic = record(row.trafficByDate);
    const money = sales.orderedProductSales == null ? null : record(sales.orderedProductSales);
    if (money && (typeof money.amount !== "number" || !Number.isFinite(money.amount) || money.amount < 0 || typeof money.currencyCode !== "string" || !/^[A-Z]{3}$/.test(money.currencyCode))) throw new Error("报告金额或币种无效。");
    const metrics = { unitsOrdered: count(sales.unitsOrdered), totalOrderItems: count(sales.totalOrderItems), sessions: count(traffic.sessions), pageViews: count(traffic.pageViews), orderedProductSales: money ? { amount: money.amount as number, currencyCode: money.currencyCode as string } : null };
    return { businessDate: date, metrics, quality: Object.values(metrics).some(v => v === null) ? "MISSING_FIELDS" : "VALID" };
  });
  const missingDates: string[] = [];
  for (let date = range.from; date <= range.to; date = shiftDate(date, 1)) if (!seen.has(date)) missingDates.push(date);
  return { rows, missingDates, complete: range.periodClosed && missingDates.length === 0 && rows.every(r => r.quality === "VALID") };
}

export type ProductGranularity = "CHILD" | "SKU";
/**
 * 解析单日商品级报告 salesAndTrafficByAsin 为商品日事实。
 * 硬约束：仅接受单日、已闭合窗口——多日 ASIN 汇总没有逐日日期，禁止拆分/平均到每天。
 * 身份：CHILD 用 childAsin（+parentAsin），SKU 用 childAsin + sellerSku；绝不把一个 ASIN 的销量复制/摊给多个 SKU。
 */
export function parseSalesTrafficProducts(value: unknown, range: RequestedRange, marketplaceId: string, expected?: ProductGranularity) {
  const root = record(value), specification = record(root.reportSpecification), options = record(specification.reportOptions);
  const granularity = options.asinGranularity;
  if (granularity !== "CHILD" && granularity !== "SKU") throw new Error("商品报告粒度必须为 CHILD 或 SKU。");
  if (expected && granularity !== expected) throw new Error("商品报告粒度与冻结任务不一致。");
  if (specification.reportType !== salesTrafficReportType || options.dateGranularity !== "DAY" || !Array.isArray(specification.marketplaceIds) || specification.marketplaceIds.length !== 1 || specification.marketplaceIds[0] !== marketplaceId) throw new Error("报告类型、站点或粒度与冻结任务不匹配。");
  // 商品日事实只能来自单日已闭合窗口；多日窗口 ASIN 汇总无逐日日期，禁止拆分。
  if (range.from !== range.to) throw new Error("商品日事实仅接受单日报告窗口，不能拆分多日 ASIN 汇总。");
  if (!range.periodClosed) throw new Error("商品日仅接受已闭合业务日。");
  const start = String(specification.dataStartTime), end = String(specification.dataEndTime);
  const startMatches = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start === range.from : [range.startAt, `${range.from}T00:00:00Z`].some(expected => Date.parse(start) === Date.parse(expected));
  const endMatches = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end === range.to : [range.reportEndAt, `${range.to}T23:59:59Z`].some(expected => Date.parse(end) === Date.parse(expected));
  if (!startMatches || !endMatches) throw new Error("报告日期范围不匹配。");
  const raw = root.salesAndTrafficByAsin;
  if (!Array.isArray(raw)) throw new Error("商品报告缺少 salesAndTrafficByAsin。");
  const businessDay = range.from;
  const seen = new Set<string>();
  const rows = raw.map(item => {
    const row = record(item);
    const childAsin = row.childAsin;
    if (typeof childAsin !== "string" || !/^[A-Z0-9]{10}$/.test(childAsin)) throw new Error("商品报告 childAsin 无效。");
    const parentAsin = row.parentAsin == null ? null : (typeof row.parentAsin === "string" && /^[A-Z0-9]{10}$/.test(row.parentAsin) ? row.parentAsin : (() => { throw new Error("商品报告 parentAsin 无效。"); })());
    // SKU 粒度才有 sellerSku；CHILD 粒度没有，保持 null，绝不从库存/Listing 猜测。
    const skuRaw = row.sku;
    const sellerSku = granularity === "SKU" ? (typeof skuRaw === "string" && skuRaw.trim() ? skuRaw.trim().slice(0, 100) : null) : null;
    if (granularity === "SKU" && !sellerSku) throw new Error("SKU 报告缺少有效 sellerSku。");
    const identity = `${childAsin}|${sellerSku ?? ""}`;
    if (seen.has(identity)) throw new Error("商品报告存在重复商品身份。");
    seen.add(identity);
    const sales = row.salesByAsin == null ? {} : record(row.salesByAsin);
    const traffic = row.trafficByAsin == null ? {} : record(row.trafficByAsin);
    const money = sales.orderedProductSales == null ? null : record(sales.orderedProductSales);
    if (money && (typeof money.amount !== "number" || !Number.isFinite(money.amount) || money.amount < 0 || typeof money.currencyCode !== "string" || !/^[A-Z]{3}$/.test(money.currencyCode))) throw new Error("商品报告金额或币种无效。");
    const metrics = {
      unitsOrdered: count(sales.unitsOrdered), totalOrderItems: count(sales.totalOrderItems),
      sessions: count(traffic.sessions), pageViews: count(traffic.pageViews),
      orderedProductSales: money ? { amount: money.amount as number, currencyCode: money.currencyCode as string } : null,
    };
    return { businessDate: businessDay, granularity: granularity as ProductGranularity, childAsin, parentAsin, sellerSku, metrics, quality: Object.values(metrics).some(v => v === null) ? "MISSING_FIELDS" : "VALID" };
  });
  return { granularity: granularity as ProductGranularity, rows, complete: rows.length > 0 && rows.every(r => r.quality === "VALID"), rowCount: rows.length };
}
