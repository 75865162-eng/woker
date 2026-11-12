import { shiftDate } from "./date-range";
import { SyncInputError } from "./policy";

export type CompleteDayWindow = { from: string; to: string };
export type AutomaticDayWindowPolicy = {
  historyDays: number;
  maxWindowDays: number;
  /** Zero means caught-up sources wait for another closed day. */
  refreshDays: number;
  frozenWindowKey: "requestedRange" | "reportWindow";
  requiredCoverageFlags: readonly string[];
  /** For example, an all-event ledger window must freeze eventType="". */
  requiredWindowFields?: Readonly<Record<string, string>>;
};
export type AutomaticDayWindow = CompleteDayWindow & { mode: "history" | "refresh"; backfill: boolean };
export const salesTrafficDayWindows: AutomaticDayWindowPolicy = { historyDays: 730, maxWindowDays: 31, refreshDays: 7, frozenWindowKey: "requestedRange", requiredCoverageFlags: ["complete"] };
export const inventoryEventDayWindows: AutomaticDayWindowPolicy = { historyDays: 540, maxWindowDays: 31, refreshDays: 0, frozenWindowKey: "reportWindow", requiredCoverageFlags: ["complete", "transportComplete", "attributionComplete"], requiredWindowFields: { eventType: "" } };
export const reimbursementDayWindows: AutomaticDayWindowPolicy = { historyDays: 730, maxWindowDays: 30, refreshDays: 1, frozenWindowKey: "reportWindow", requiredCoverageFlags: ["complete", "transportComplete", "attributionComplete"] };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Operates on complete evidence only. A later covered island caps a repair;
 * overlapping/repeated refreshes cannot turn a real hole into coverage. */
export function nextAutomaticDayWindow(today: string, policy: AutomaticDayWindowPolicy, covered: CompleteDayWindow[]): AutomaticDayWindow | null {
  if (!validDate(today) || ![policy.historyDays, policy.maxWindowDays, policy.refreshDays].every(Number.isSafeInteger)
    || policy.historyDays < 1 || policy.maxWindowDays < 1 || policy.refreshDays < 0 || policy.refreshDays > policy.maxWindowDays) throw new SyncInputError("自动日期窗口策略无效。", 422);
  const initial = shiftDate(today, -policy.historyDays), latest = shiftDate(today, -1);
  let through = shiftDate(initial, -1), nextIsland: string | undefined;
  for (const window of [...covered].filter(window => validDate(window.from) && validDate(window.to) && window.from <= window.to)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
    if (window.to <= through || window.from > latest) continue;
    if (window.from > shiftDate(through, 1)) { nextIsland = window.from; break; }
    through = window.to;
  }
  if (through >= latest) return policy.refreshDays ? { from: [initial, shiftDate(latest, 1 - policy.refreshDays)].sort().at(-1)!, to: latest, mode: "refresh", backfill: false } : null;
  const from = shiftDate(through, 1);
  const to = [shiftDate(from, policy.maxWindowDays - 1), latest, ...(nextIsland ? [shiftDate(nextIsland, -1)] : [])].sort()[0];
  return { from, to, mode: "history", backfill: to < latest };
}
