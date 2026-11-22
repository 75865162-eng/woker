import assert from "node:assert/strict";
import test from "node:test";
import { isSellfoxManualBackfill, planSellfoxSalesBackfill } from "@/lib/sellfox/backfill-plan";

test("only explicit persisted manual backfills receive background priority", () => {
  assert.equal(isSellfoxManualBackfill({ trigger: "manual_backfill" }), true);
  for (const summary of [null, [], {}, { trigger: "schedule" }, { trigger: "manual" }]) assert.equal(isSellfoxManualBackfill(summary), false);
});

test("backfill skips covered dates per store and splits gaps into bounded contiguous runs", () => {
  const units = planSellfoxSalesBackfill({ startDate: "2025-11-01", endDate: "2025-11-07", chunkDays: 3, shopExternalIds: ["b", "a"], coverage: [{ shopExternalId: "a", reportDate: "2025-11-02" }, { shopExternalId: "a", reportDate: "2025-11-03" }] });
  assert.deepEqual(units.filter((unit) => unit.shopExternalId === "a"), [
    { shopExternalId: "a", startDate: "2025-11-01", endDate: "2025-11-01", days: 1 },
    { shopExternalId: "a", startDate: "2025-11-04", endDate: "2025-11-06", days: 3 },
    { shopExternalId: "a", startDate: "2025-11-07", endDate: "2025-11-07", days: 1 },
  ]);
  assert.equal(units.reduce((n, unit) => n + unit.days, 0), 12);
});
test("backfill handles leap days and fully covered windows without requesting them again", () => {
  const scope = { startDate: "2024-02-28", endDate: "2024-03-01", chunkDays: 90, shopExternalIds: ["a"] };
  const [unit] = planSellfoxSalesBackfill({ ...scope, coverage: [] });
  assert.equal(unit.days, 3);
  assert.deepEqual(planSellfoxSalesBackfill({ ...scope, coverage: ["2024-02-28", "2024-02-29", "2024-03-01"].map((reportDate) => ({ shopExternalId: "a", reportDate })) }), []);
});
test("backfill refuses invalid dates, beyond full-history cap, duplicate shops and unsupported chunks", () => {
  const input = { startDate: "2025-11-01", endDate: "2025-11-07", chunkDays: 7, shopExternalIds: ["a"], coverage: [] };
  // 系统自设的三年上限已放开：2020 起点与 chunkDays:91 现在合法。
  for (const patch of [{ startDate: "2025-02-30" }, { endDate: "2025-10-31" }, { chunkDays: 3651 }, { chunkDays: 0 }, { shopExternalIds: ["a", "a"] }]) assert.throws(() => planSellfoxSalesBackfill({ ...input, ...patch }));
  assert.ok(planSellfoxSalesBackfill({ ...input, startDate: "2020-01-01" }).length > 0, "全量历史起点合法");
});
