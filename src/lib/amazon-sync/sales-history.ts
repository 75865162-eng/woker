import { automaticAdapter } from "./automatic-adapters";
import { readAutomaticDayHistory } from "./automatic-day-history";
import type { HistorySource } from "./history-authorization";
import { localDate, reportTimeZone } from "./date-range";
import type { SyncScope } from "./policy";

/** Existing sales reader and automatic planning share one evidence repository. */
export async function readSalesHistoryCoverage(scope: SyncScope, source: HistorySource, now: Date) {
  const policy = automaticAdapter("sales_traffic")!.dayWindows!;
  return readAutomaticDayHistory(scope, source, localDate(now, reportTimeZone(source.marketplaceId)), policy);
}
