import { Prisma } from "@prisma/client";
import { businessDate, localDate, reportTimeZone, shiftDate } from "./date-range";
import { SyncInputError, type SyncScope } from "./policy";
import { readSalesTraffic, type SalesMetrics } from "./sales-query";

type Day = { businessDate: string; metrics: SalesMetrics; syncRunId: string; capturedAt: Date; reportId: string };

export function summarizeOverviewPeriod(from: string, rows: Day[]) {
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(from, i));
  const byDate = new Map<string, Day[]>();
  for (const row of rows) byDate.set(row.businessDate, [...(byDate.get(row.businessDate) ?? []), row]);
  const missingDates = dates.filter(date => !byDate.has(date));
  const ambiguousDates = dates.filter(date => (byDate.get(date)?.length ?? 0) !== 1 && byDate.has(date));
  const complete = !missingDates.length && !ambiguousDates.length && rows.length === 7;
  const values = rows.map(row => row.metrics.orderedProductSales);
  const currencies = [...new Set(values.map(value => value?.currencyCode).filter((value): value is string => typeof value === "string" && value.length > 0))];
  const valid = complete && currencies.length === 1 && values.every(value => typeof value?.amount === "string" && /^-?\d+(?:\.\d+)?$/.test(value.amount) && value.currencyCode === currencies[0]);
  const sales = valid ? { amount: values.reduce((sum, value) => sum.plus(value!.amount!), new Prisma.Decimal(0)).toFixed(), currency: currencies[0] } : null;
  return { from, to: dates[6], complete, missingDates, ambiguousDates, orderedProductSales: sales,
    orderCount: null, orderCountReason: "店铺销售日报的 totalOrderItems 是订单商品行数，不能作为订单数。", rows };
}

export async function readStoreOverview(scope: SyncScope, actor: string, input: { sellerAccountId: string; marketplaceId: string; from: string; to: string }, sourceFence: string[]) {
  const from = businessDate(input.from), to = businessDate(input.to), timeZone = reportTimeZone(input.marketplaceId);
  if (shiftDate(from, 6) !== to || to >= localDate(new Date(), timeZone)) throw new SyncInputError("请指定已结束的连续七个业务日。", 400);
  const priorFrom = shiftDate(from, -7);
  const params = new URLSearchParams({ sellerAccountId: input.sellerAccountId, marketplaceId: input.marketplaceId, from: priorFrom, to, direction: "asc" });
  const data = await readSalesTraffic(scope, params, { actor, pageSize: 100, sourceFence });
  if (data.pagination.total > data.rows.length) throw new SyncInputError("销售数据超过安全上限，请检查重复来源。", 409);
  const current = summarizeOverviewPeriod(from, data.rows.filter(row => row.businessDate >= from));
  const previous = summarizeOverviewPeriod(priorFrom, data.rows.filter(row => row.businessDate < from));
  return { sellerAccountId: input.sellerAccountId, marketplaceId: input.marketplaceId, timeZone, dateField: data.dateField,
    source: "amazon_sp_api_snapshot", asOf: data.asOf, granularity: data.granularity, current, previous,
    comparable: !!current.orderedProductSales && !!previous.orderedProductSales && current.orderedProductSales.currency === previous.orderedProductSales.currency,
    productChanges: null, productChangesReason: "此数据源为店铺逐日汇总，不提供商品级销售。" };
}
