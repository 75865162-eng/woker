import type { AmazonSyncDataSource, AmazonSyncSchedule } from "@prisma/client";
import type { RequestedRange } from "./date-range";
import type { OrderWindow } from "./orders";
import type { FinanceWindow } from "./finance";
import type { DomainReportWindow } from "./domain-reports";
import type { SyncScope } from "./policy";
import type { AutomaticAdapter } from "./automatic-adapters";
import type { AutomaticDayWindowPolicy, CompleteDayWindow } from "./automatic-day-windows";
import type { HistorySource } from "./history-authorization";
import type { CompleteHistoryWindow } from "./automatic-window-history";

export type AutomaticPlannerSource = Pick<AmazonSyncDataSource, "id" | "resource" | "revision" | "authorizationId" | "marketplaceId" | "orderPolicy" | "financePolicy" | "returnsPolicy" | "domainPolicy"> & {
  sellerAccountId?: string;
  authorization: { revision: number; status: string; amazonSellerId?: string | null; identityVerifiedAt?: Date | null };
  resourceCursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null;
};
export type AutomaticPlannerSchedule = Pick<AmazonSyncSchedule, "id" | "revision" | "maxAttempts" | "priority" | "intervalMinutes">;
type Payload = { requestedRange?: RequestedRange; orderWindow?: OrderWindow; orderHistoryReplay?: boolean; financeWindow?: FinanceWindow; financeHistoryReplay?: boolean; returnWindow?: FinanceWindow; returnHistoryReplay?: boolean; reportWindow?: DomainReportWindow; reimbursementHistoryReplay?: boolean; inventoryEventHistoryReplay?: boolean; brandPolicy?: unknown; buyBoxPolicy?: unknown };
export type AutomaticTaskPlan = { keyFrom: string; keyTo?: string; payload: Payload; backfill: boolean; deferUntil?: Date };

export type CompleteFinanceWindow = { from: string; to: string };

export type AutomaticPlannerRuntime = {
  readDayHistory: (scope: SyncScope, source: HistorySource, today: string, policy: AutomaticDayWindowPolicy) => Promise<CompleteDayWindow[]>;
  readFinanceHistory: (scope: SyncScope, source: HistorySource, from: string, to: string) => Promise<CompleteFinanceWindow[]>;
  readOrderHistory?: (scope: SyncScope, source: HistorySource, from: string, to: string, orderPolicy: unknown) => Promise<CompleteHistoryWindow[]>;
  readReturnHistory?: (scope: SyncScope, source: HistorySource, from: string, to: string, returnsPolicy: unknown) => Promise<CompleteHistoryWindow[]>;
};
export type AutomaticTaskPlanner = (adapter: AutomaticAdapter, scope: SyncScope, source: AutomaticPlannerSource, plan: AutomaticPlannerSchedule, now: Date, runtime: AutomaticPlannerRuntime) => AutomaticTaskPlan | null | Promise<AutomaticTaskPlan | null>;
