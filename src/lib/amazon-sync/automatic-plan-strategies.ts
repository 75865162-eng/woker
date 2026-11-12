import { nextBuyBoxPolicy } from "./buy-box-history";
import { nextBrandCollectionPolicy } from "./brand-collection-query";
import { brandWindowKey } from "./brand-collection";
import { automaticSnapshotSlot, nextAutomaticInventoryEventWindow, nextAutomaticRemovalOrderWindow, nextAutomaticReimbursementWindow, nextAutomaticReturnWindow, nextAutomaticSettlementDiscovery } from "./automatic-window-rules";
import { financeRetentionFloor, financeWindowFromFrozen, nextFinanceWindow, parseFinancePolicy } from "./finance";
import { nextOrderWindow, orderWindowFromFrozen, parseOrderSyncPolicy } from "./orders";
import { returnWindowFromFrozen, parseReturnPolicy } from "./returns";
import { domainReportRunWindow, mfnReturnsRunWindow } from "./domain-reports";
import { parseObservationPolicy } from "./observation-policy";
import { prisma } from "@/lib/db/prisma";
import { SyncInputError } from "./policy";
import { nextAutomaticDayWindow } from "./automatic-day-windows";
import { nextFinanceHistoryGap } from "./automatic-finance-history";
import { nextInternalWindowGap } from "./automatic-window-history";
import { latestClosedStorageFeeMonth, nextStorageFeeMonth } from "./long-term-storage-fees";
import { localDate, reportTimeZone, resolveRequestedRange } from "./date-range";

import type { AutomaticTaskPlanner, AutomaticPlannerSchedule } from "./automatic-planner-contract";
import type { AutomaticAdapter } from "./automatic-adapters";

/** A refresh is intentional new collection, while retries of an unfinished
 * window retain the original key, task and archive/checkpoint identity. */
function completedWindowKey(adapter: AutomaticAdapter, plan: AutomaticPlannerSchedule, now: Date, to: string, refresh: boolean) {
  return refresh && adapter.refreshCompletedWindow ? `${to}:refresh:${automaticSnapshotSlot(now, plan.intervalMinutes)}` : to;
}

export const planBrandAnalytics: AutomaticTaskPlanner = async (_adapter, scope, source) => {
  const brandPolicy = await nextBrandCollectionPolicy(prisma, scope, source);
  return { keyFrom: brandWindowKey(brandPolicy), payload: { brandPolicy }, backfill: true };
};

export const planBuyBoxHistory: AutomaticTaskPlanner = async (_adapter, scope, source, _plan, now) => {
  const buyBoxPolicy = await nextBuyBoxPolicy(prisma, scope, source, now);
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: buyBoxPolicy.marketplaceTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - 86400000));
  return { keyFrom: buyBoxPolicy.from, keyTo: buyBoxPolicy.to, payload: { buyBoxPolicy }, backfill: buyBoxPolicy.from < yesterday };
};

export const planOrders: AutomaticTaskPlanner = async (_adapter, scope, source, _plan, now, runtime) => {
  const cursor = source.resourceCursor;
  if (!source.orderPolicy) return null;
  const policy = parseOrderSyncPolicy(source.orderPolicy);
  if (cursor && cursor.status !== "SUCCEEDED") throw new SyncInputError("ORDER_WINDOW_REQUIRES_RECOVERY：未完成订单窗口须通过原任务恢复，不自动创建替代任务。", 409);
  if (cursor?.status === "SUCCEEDED" && runtime.readOrderHistory) {
    const windows = await runtime.readOrderHistory(scope, source, policy.initialFrom, cursor.watermarkTo.toISOString(), policy);
    const gap = nextInternalWindowGap(policy.initialFrom, cursor.watermarkTo.toISOString(), windows, policy.windowMinutes * 60000);
    if (gap) return { keyFrom: `history:${gap.from}`, keyTo: gap.to, payload: { orderWindow: orderWindowFromFrozen(gap), orderHistoryReplay: true }, backfill: true };
  }
  const window = nextOrderWindow(policy, cursor, now);
  return { keyFrom: window.from, keyTo: window.to, payload: { orderWindow: orderWindowFromFrozen(window) }, backfill: Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000 };
};

export const planFinance: AutomaticTaskPlanner = async (_adapter, scope, source, _plan, now, runtime) => {
  const cursor = source.resourceCursor;
  if (!source.financePolicy) return null;
  const policy = parseFinancePolicy(source.financePolicy);
  if (cursor?.status === "SUCCEEDED") {
    const earliestRequest = new Date(financeRetentionFloor(now).getTime() + 86400000).toISOString();
    const historyFrom = earliestRequest > policy.initialFrom ? earliestRequest : policy.initialFrom;
    const history = await runtime.readFinanceHistory(scope, source, historyFrom, cursor.watermarkTo.toISOString());
    const gap = nextFinanceHistoryGap(historyFrom, cursor.watermarkTo.toISOString(), history, policy.windowMinutes * 60000);
    if (gap) return { keyFrom: `history:${gap.from}`, keyTo: gap.to, payload: { financeWindow: gap, financeHistoryReplay: true }, backfill: true };
  }
  const window = nextFinanceWindow(policy, cursor, now);
  return { keyFrom: window.from, keyTo: window.to, payload: { financeWindow: financeWindowFromFrozen(window) }, backfill: Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000 };
};

export const planReturns: AutomaticTaskPlanner = async (_adapter, scope, source, _plan, now, runtime) => {
  const cursor = source.resourceCursor;
  if (!source.returnsPolicy) return null;
  const policy = parseReturnPolicy(source.returnsPolicy);
  if (cursor?.status === "SUCCEEDED" && runtime.readReturnHistory) {
    const windows = await runtime.readReturnHistory(scope, source, policy.initialFrom, cursor.watermarkTo.toISOString(), policy);
    const gap = nextInternalWindowGap(policy.initialFrom, cursor.watermarkTo.toISOString(), windows, policy.windowMinutes * 60000);
    if (gap) return { keyFrom: `history:${gap.from}`, keyTo: gap.to, payload: { returnWindow: returnWindowFromFrozen(gap), returnHistoryReplay: true }, backfill: true };
  }
  const window = nextAutomaticReturnWindow(policy, cursor, now);
  return { keyFrom: window.from, keyTo: window.to, payload: { returnWindow: returnWindowFromFrozen(window) }, backfill: Date.parse(window.to) < now.getTime() - policy.safetyLagSeconds * 1000 };
};

export const planSalesTraffic: AutomaticTaskPlanner = async (adapter, scope, source, plan, now, runtime) => {
  if (!adapter.dayWindows) throw new SyncInputError("日期报告缺少窗口策略。", 422);
  const today = localDate(now, reportTimeZone(source.marketplaceId));
  const next = nextAutomaticDayWindow(today, adapter.dayWindows, await runtime.readDayHistory(scope, source, today, adapter.dayWindows));
  if (!next) return null;
  const range = resolveRequestedRange(source.marketplaceId, { datePreset: "custom", dateFrom: next.from, dateTo: next.to }, now);
  return { keyFrom: range.from, keyTo: completedWindowKey(adapter, plan, now, range.to, next.mode === "refresh"), payload: { requestedRange: range }, backfill: next.backfill };
};

export const planInventoryEvents: AutomaticTaskPlanner = async (adapter, scope, source, _plan, now, runtime) => {
  const cursor = source.resourceCursor;
  if (!adapter.dayWindows) throw new SyncInputError("日期报告缺少窗口策略。", 422);
  const today = now.toISOString().slice(0, 10);
  const selected = cursor && cursor.status !== "SUCCEEDED" ? null : nextAutomaticDayWindow(today, adapter.dayWindows, await runtime.readDayHistory(scope, source, today, adapter.dayWindows));
  const window = cursor && cursor.status !== "SUCCEEDED" ? nextAutomaticInventoryEventWindow(cursor, now)
    : selected ? { from: selected.from, to: selected.to, dataStartTime: `${selected.from}T00:00:00Z`, dataEndTime: `${selected.to}T23:59:59Z`, eventType: "" } : null;
  if (!window) return { keyFrom: "no-closed-window", payload: {}, backfill: false, deferUntil: new Date(now.getTime() + adapter.intervalMinutes * 60_000) };
  const reportWindow = domainReportRunWindow("inventory_events", window, now);
  if (!reportWindow) return null;
  const historyReplay = selected?.mode === "history" && !!cursor && cursor.status === "SUCCEEDED" && Date.parse(window.dataEndTime) <= cursor.watermarkTo.getTime();
  return { keyFrom: historyReplay ? `history:${window.from}` : window.from, keyTo: window.to, payload: { reportWindow, ...(historyReplay ? { inventoryEventHistoryReplay: true } : {}) }, backfill: window.to < new Date(now.getTime() - 86400000).toISOString().slice(0, 10) };
};

export const planRemovalOrders: AutomaticTaskPlanner = (_adapter, _scope, source, _plan, now) => {
  const cursor = source.resourceCursor;
  const window = nextAutomaticRemovalOrderWindow(cursor, now);
  if (!window) return null;
  const reportWindow = domainReportRunWindow(source.resource as "removal_order_report" | "removal_shipment_report", window, now);
  return reportWindow ? { keyFrom: window.from, keyTo: window.to, payload: { reportWindow }, backfill: window.to < new Date(now.getTime() - 86400000).toISOString().slice(0, 10) } : null;
};

export const planFbaShipments: AutomaticTaskPlanner = (_adapter, _scope, source, _plan, now) => {
  const cursor = source.resourceCursor;
  const latest = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const from = cursor && cursor.status !== "SUCCEEDED"
    ? cursor.watermarkFrom.toISOString().slice(0, 10)
    : new Date(Date.parse(`${latest}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = cursor && cursor.status !== "SUCCEEDED" ? cursor.watermarkTo.toISOString().slice(0, 10) : latest;
  const reportWindow = domainReportRunWindow("fba_shipments", { from, to }, now);
  return reportWindow ? { keyFrom: from, keyTo: to, payload: { reportWindow }, backfill: false } : null;
};

export const planLongTermStorageFees: AutomaticTaskPlanner = (adapter, _scope, source, plan, now) => {
  const cursor = source.resourceCursor;
  const window = nextStorageFeeMonth(cursor, now);
  const refresh = cursor?.status === "SUCCEEDED" && cursor.watermarkFrom.toISOString().slice(0, 10) === window.from;
  return { keyFrom: window.from, keyTo: completedWindowKey(adapter, plan, now, window.to, refresh), payload: { reportWindow: window }, backfill: window.to < latestClosedStorageFeeMonth(now).to };
};

export const planSettlements: AutomaticTaskPlanner = (_adapter, _scope, source, _plan, now) => {
  const cursor = source.resourceCursor;
  const window = nextAutomaticSettlementDiscovery(now, cursor), reportWindow = domainReportRunWindow("settlements", window, now);
  if (!reportWindow) return null;
  return { keyFrom: window.createdSince.slice(0, 10), keyTo: window.createdUntil.slice(0, 10), payload: { reportWindow }, backfill: false };
};

export const planReimbursements: AutomaticTaskPlanner = async (adapter, scope, source, plan, now, runtime) => {
  const cursor = source.resourceCursor;
  if (!adapter.dayWindows) throw new SyncInputError("日期报告缺少窗口策略。", 422);
  const today = now.toISOString().slice(0, 10);
  const selected = cursor && cursor.status !== "SUCCEEDED" ? null : nextAutomaticDayWindow(today, adapter.dayWindows, await runtime.readDayHistory(scope, source, today, adapter.dayWindows));
  const window = cursor && cursor.status !== "SUCCEEDED" ? nextAutomaticReimbursementWindow(now, cursor)
    : selected ? { from: selected.from, to: selected.to, dataStartTime: `${selected.from}T00:00:00Z`, dataEndTime: `${selected.to}T23:59:59Z` } : null;
  if (!window) return null;
  const historyReplay = selected?.mode === "history" && !!cursor && cursor.status === "SUCCEEDED" && Date.parse(window.dataEndTime) <= cursor.watermarkTo.getTime();
  return { keyFrom: historyReplay ? `history:${window.from}` : window.from, keyTo: completedWindowKey(adapter, plan, now, window.to, !historyReplay && selected?.mode === "refresh"),
    payload: { reportWindow: window, ...(historyReplay ? { reimbursementHistoryReplay: true } : {}) }, backfill: window.to < new Date(now.getTime() - 86400000).toISOString().slice(0, 10) };
};

export const planSnapshot: AutomaticTaskPlanner = (_adapter, _scope, _source, plan, now) => {
  return { keyFrom: automaticSnapshotSlot(now, plan.intervalMinutes), payload: {}, backfill: false };
};

export const planMfnReturns: AutomaticTaskPlanner = (adapter, _scope, _source, plan, now) => {
  const to = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 59 * 86_400_000).toISOString().slice(0, 10);
  const reportWindow = mfnReturnsRunWindow({ from, to }, now);
  return { keyFrom: completedWindowKey(adapter, plan, now, to, true), keyTo: to, payload: { reportWindow }, backfill: false };
};

export const planObservation: AutomaticTaskPlanner = (adapter, _scope, source, plan, now) => {
  if (!source.domainPolicy) return null;
  const policy = parseObservationPolicy(source.domainPolicy, adapter.resource);
  if (policy.resource === "brand_analytics" || policy.resource === "buy_box_history") return null;
  return { keyFrom: automaticSnapshotSlot(now, plan.intervalMinutes), payload: {}, backfill: false };
};
