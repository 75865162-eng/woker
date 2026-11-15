import assert from "node:assert/strict";
import test from "node:test";

import { addDays, weekdayOf } from "@/lib/forecast/types";
import { buildReplenishmentDemandForecast } from "@/lib/operations/replenishment-forecast";

function history(from: string, days: number, units: (index: number, date: string) => number) {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    return { date, units: Math.round(units(index, date)) };
  });
}

test("weekly seasonality in full history produces a P50/P90 pair", () => {
  const rows = history("2026-01-01", 200, (_index, date) => {
    const weekday = weekdayOf(date);
    return weekday === 0 || weekday === 6 ? 24 : 10;
  });
  const built = buildReplenishmentDemandForecast({ salesHistory: rows, asOf: addDays("2026-01-01", 200), horizonDays: 60 });
  assert.equal(built.status, "APPLIED");
  assert.ok(built.forecast);
  assert.ok(built.forecast!.p50Daily > 10, "周末峰值必须抬高平均日需求");
  assert.ok(built.forecast!.p90Daily >= built.forecast!.p50Daily);
  assert.equal(built.forecast!.asOf, addDays("2026-01-01", 200));
  assert.notEqual(built.forecast!.confidence, "UNKNOWN");
});

test("constant demand forecasts its own level, not a fabricated ramp", () => {
  const rows = history("2026-01-01", 120, () => 12);
  const built = buildReplenishmentDemandForecast({ salesHistory: rows, asOf: addDays("2026-01-01", 120), horizonDays: 30 });
  assert.equal(built.status, "APPLIED");
  assert.ok(Math.abs(built.forecast!.p50Daily - 12) < 0.6, `expected ~12, got ${built.forecast!.p50Daily}`);
});

test("short history is refused instead of extrapolated", () => {
  const rows = history("2026-10-01", 20, () => 10);
  const built = buildReplenishmentDemandForecast({ salesHistory: rows, asOf: addDays("2026-10-01", 20), horizonDays: 30 });
  assert.equal(built.status, "SKIPPED");
  assert.equal(built.forecast, null);
  assert.match(built.note, /预测条件不足/);
});

test("a gap in the history is not treated as zero sales", () => {
  const rows = history("2026-01-01", 120, () => 10).filter((row) => !["2026-03-10", "2026-03-11", "2026-03-12"].includes(row.date));
  const built = buildReplenishmentDemandForecast({ salesHistory: rows, asOf: addDays("2026-01-01", 120), horizonDays: 30 });
  assert.equal(built.status, "SKIPPED");
  assert.equal(built.forecast, null);
});

test("zero sales never becomes a zero-demand plan", () => {
  const rows = history("2026-01-01", 120, () => 0);
  const built = buildReplenishmentDemandForecast({ salesHistory: rows, asOf: addDays("2026-01-01", 120), horizonDays: 30 });
  assert.equal(built.status, "SKIPPED");
  assert.equal(built.forecast, null);
});

test("no history keeps the deterministic model and says so", () => {
  const built = buildReplenishmentDemandForecast({ salesHistory: [], asOf: "2026-11-14", horizonDays: 60 });
  assert.equal(built.status, "SKIPPED");
  assert.match(built.note, /无销量历史/);
  assert.equal(built.detail.horizonDays, 60);
});
