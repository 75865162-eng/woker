import { businessDate, shiftDate, type RequestedRange } from "./date-range";
export const salesTrafficReportType = "GET_SALES_AND_TRAFFIC_REPORT";
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("销售流量报告结构无效。"); return v as Record<string, unknown>; }
function count(v: unknown): number | null { if (v === undefined || v === null) return null; if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("报告计数无效。"); return v; }
export function parseSalesTraffic(value: unknown, range: RequestedRange, marketplaceId: string) {
  const root = record(value), specification = record(root.reportSpecification), options = record(specification.reportOptions);
  if (specification.reportType !== salesTrafficReportType || options.dateGranularity !== "DAY" || options.asinGranularity !== "CHILD" || !Array.isArray(specification.marketplaceIds) || specification.marketplaceIds.length !== 1 || specification.marketplaceIds[0] !== marketplaceId) throw new Error("报告类型、站点或粒度与冻结任务不匹配。");
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
