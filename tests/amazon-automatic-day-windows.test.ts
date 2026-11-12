import test from "node:test";
import assert from "node:assert/strict";
import { nextAutomaticDayWindow, inventoryEventDayWindows, reimbursementDayWindows, salesTrafficDayWindows } from "@/lib/amazon-sync/automatic-day-windows";
import { automaticAdapter } from "@/lib/amazon-sync/automatic-adapters";
import { planAutomaticTask } from "@/lib/amazon-sync/automatic-planner";
import { shiftDate } from "@/lib/amazon-sync/date-range";

const today = "2026-11-10", now = new Date(`${today}T12:00:00Z`);
const policy = { ...salesTrafficDayWindows, historyDays: 10, maxWindowDays: 3, refreshDays: 2 };

test("daily history repairs the first hole without recapturing the next complete island", () => {
  const covered = [{ from: "2026-11-01", to: "2026-11-03" }, { from: "2026-11-06", to: "2026-11-09" }, { from: "2026-11-01", to: "2026-11-03" }];
  const first = nextAutomaticDayWindow(today, policy, covered)!;
  assert.deepEqual(first, { from: "2026-10-31", to: "2026-10-31", mode: "history", backfill: true });
  const second = nextAutomaticDayWindow(today, policy, [...covered, first])!;
  assert.deepEqual(second, { from: "2026-11-04", to: "2026-11-05", mode: "history", backfill: true });
  assert.deepEqual(nextAutomaticDayWindow(today, policy, [...covered, first, second]), { from: "2026-11-08", to: "2026-11-09", mode: "refresh", backfill: false });
});

test("daily history is bounded, calendar-safe and ignores invalid or future evidence", () => {
  const input = [{ from: "2026-02-30", to: "2099-12-31" }, { from: "2026-11-10", to: "2099-12-31" }, { from: "2026-11-03", to: "2026-11-01" }];
  const original = structuredClone(input);
  assert.deepEqual(nextAutomaticDayWindow(today, policy, input), { from: "2026-10-31", to: "2026-11-02", mode: "history", backfill: true });
  assert.deepEqual(input, original);
  assert.equal(nextAutomaticDayWindow("2024-03-01", { ...policy, historyDays: 1, refreshDays: 0 }, [])?.from, "2024-02-29");
  assert.throws(() => nextAutomaticDayWindow(today, { ...policy, refreshDays: 4 }, []));
  assert.throws(() => nextAutomaticDayWindow("2026-02-30", policy, []));
});

test("registered report policies retain API limits and only sales rolls seven closed days", () => {
  for (const [config, max, refresh] of [[salesTrafficDayWindows, 31, 7], [inventoryEventDayWindows, 31, 0], [reimbursementDayWindows, 30, 1]] as const) {
    const complete = [{ from: shiftDate(today, -config.historyDays), to: shiftDate(today, -1) }];
    assert.equal(config.maxWindowDays, max);
    const selected = nextAutomaticDayWindow(today, config, complete);
    assert.equal(selected?.from ?? null, refresh ? shiftDate(today, -refresh) : null);
    assert.equal(nextAutomaticDayWindow(shiftDate(today, 1), config, complete)?.to, today);
  }
});

test("repeated daily repair converges across islands and obeys every request cap", () => {
  const covered = [{ from: "2026-10-20", to: "2026-10-24" }, { from: "2026-11-01", to: "2026-11-03" }];
  const config = { ...policy, historyDays: 31, refreshDays: 0 };
  for (let steps = 0; steps < 20; steps++) {
    const next = nextAutomaticDayWindow(today, config, covered);
    if (!next) { assert.ok(steps > 1); return; }
    assert.ok((Date.parse(next.to) - Date.parse(next.from)) / 86400000 < config.maxWindowDays);
    assert.ok(covered.every(item => item.from > next.to || item.to < next.from), "repair must exclude already complete days");
    covered.push(next);
  }
  assert.fail("finite bounded history must converge");
});

test("advanced cursors cannot conceal internal report holes; unfinished windows retain identity", async () => {
  for (const resource of ["inventory_events", "reimbursements"] as const) {
    const adapter = automaticAdapter(resource)!;
    const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
    const source = { id: "fixture-source", resource, revision: 1, authorizationId: "fixture-auth", marketplaceId: "ATVPDKIKX0DER", orderPolicy: null, financePolicy: null, returnsPolicy: null, domainPolicy: null,
      authorization: { revision: 1, status: "CONFIGURED" }, resourceCursor: { status: "SUCCEEDED", watermarkFrom: new Date("2026-11-09T00:00:00Z"), watermarkTo: new Date("2026-11-09T23:59:59Z") } };
    const plan = { id: "fixture-plan", revision: 1, intervalMinutes: 1440, maxAttempts: 3, priority: 1 };
    const config = adapter.dayWindows!, initial = shiftDate(today, -config.historyDays), gap = "2026-10-01";
    let reads = 0;
    const runtime = { readDayHistory: async () => { reads++; return [{ from: initial, to: shiftDate(gap, -1) }, { from: shiftDate(gap, 1), to: "2026-11-09" }]; }, readFinanceHistory: async () => [] };
    const repaired = await planAutomaticTask(adapter, scope, source, plan, now, runtime);
    assert.equal(repaired?.keyFrom, `history:${gap}`); assert.equal(repaired?.keyTo, gap); assert.equal(reads, 1);
    assert.equal(repaired?.payload[resource === "inventory_events" ? "inventoryEventHistoryReplay" : "reimbursementHistoryReplay"], true);
    assert.deepEqual(repaired?.payload.reportWindow && "from" in repaired.payload.reportWindow ? [repaired.payload.reportWindow.from, repaired.payload.reportWindow.to] : null, [gap, gap]);
    const pending = await planAutomaticTask(adapter, scope, { ...source, resourceCursor: { ...source.resourceCursor, status: "FAILED" } }, plan, now,
      { readDayHistory: async () => { throw new Error("unfinished windows must not replan history"); }, readFinanceHistory: async () => [] });
    assert.equal(pending?.keyFrom, "2026-11-09"); assert.equal(pending?.keyTo, "2026-11-09");
  }
});
