import type { SyncScope } from "./policy";
import type { AutomaticAdapter } from "./automatic-adapters";
import type { AutomaticPlannerSource, AutomaticPlannerSchedule, AutomaticTaskPlan, AutomaticPlannerRuntime } from "./automatic-planner-contract";
import { readAutomaticDayHistory } from "./automatic-day-history";
import { readAutomaticFinanceHistory } from "./automatic-finance-history";
import { readAutomaticOrderHistory } from "./automatic-order-history";
import { readAutomaticReturnHistory } from "./automatic-return-history";
export type { AutomaticTaskPlan } from "./automatic-planner-contract";

/** The registered adapter owns window semantics; the coordinator owns durable scheduling. */
export async function planAutomaticTask(adapter: AutomaticAdapter, scope: SyncScope, source: AutomaticPlannerSource, plan: AutomaticPlannerSchedule, now: Date, runtime: AutomaticPlannerRuntime = { readDayHistory: readAutomaticDayHistory, readFinanceHistory: readAutomaticFinanceHistory, readOrderHistory: readAutomaticOrderHistory, readReturnHistory: readAutomaticReturnHistory }): Promise<AutomaticTaskPlan | null> {
  return adapter.planTask(adapter, scope, source, plan, now, runtime);
}
