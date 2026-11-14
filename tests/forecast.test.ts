import assert from "node:assert/strict";
import test from "node:test";

import { backtestForecast } from "@/lib/forecast/backtest";
import { fitRobustLevel } from "@/lib/forecast/forecast";
import { buildEventAdjustments, buildMonthlyIndex, buildWeeklyIndex } from "@/lib/forecast/seasonality";
import { forecastDemand } from "@/lib/forecast";
import { addDays, buildDenseWindow, weekdayOf } from "@/lib/forecast/types";

function history(from: string, days: number, units: (index: number, date: string) => number) {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    return { date, units: units(index, date) };
  });
}

test("stable demand produces a flat forecast with an ordered P50/P90 band", () => {
  const rows = history("2026-01-01", 120, () => 10);
  const result = forecastDemand({ history: rows, asOf: "2026-05-01", horizonDays: 14 });
  assert.equal(result.status, "READY");
  assert.equal(result.baseDailyP50, 10);
  assert.equal(result.trendPerDay, 0);
  assert.equal(result.points.length, 14);
  for (const point of result.points) {
    assert.ok(point.p90 >= point.p50);
    assert.ok(Math.abs(point.p50 - 10) < 0.01);
  }
  assert.equal(result.horizonP50Total, 140);
});

test("a missing day blocks the forecast instead of being treated as zero", () => {
  const rows = history("2026-01-01", 60, () => 8).filter((row) => row.date !== "2026-02-10");
  const result = forecastDemand({ history: rows, asOf: "2026-03-02", horizonDays: 7 });
  assert.equal(result.status, "NEEDS_DATA");
  assert.equal(result.points.length, 0);
  assert.ok(result.missingInputs.some((row) => row.includes("缺 1 天")));
});

test("duplicate dates are rejected, never averaged", () => {
  const rows = history("2026-01-01", 40, () => 5);
  const result = forecastDemand({ history: [...rows, rows[0]], asOf: "2026-02-10", horizonDays: 5 });
  assert.equal(result.status, "NEEDS_DATA");
  assert.ok(result.reasons.some((row) => row.includes("重复销量日期")));
});

test("weekly pattern lifts the matching weekday and leaves others at 1", () => {
  const rows = history("2026-01-01", 84, (_index, date) => (weekdayOf(date) === 0 ? 30 : 10));
  const weekly = buildWeeklyIndex(rows);
  assert.ok(weekly);
  const sunday = weekly.find((row) => row.weekday === 0);
  const wednesday = weekly.find((row) => row.weekday === 3);
  assert.ok(sunday && wednesday);
  assert.ok(sunday.reliable);
  assert.ok(sunday.index > 2);
  // Workday index is normalised against the overall mean, so it must sit below 1.
  assert.ok(wednesday.index > 0.7 && wednesday.index < 0.85);

  const result = forecastDemand({ history: rows, asOf: "2026-03-26", horizonDays: 14, events: [] });
  assert.equal(result.status, "READY");
  const sundayPoints = result.points.filter((point) => weekdayOf(point.date) === 0);
  const otherPoints = result.points.filter((point) => weekdayOf(point.date) !== 0);
  assert.ok(sundayPoints.length > 0 && otherPoints.length > 0);
  assert.ok(Math.min(...sundayPoints.map((row) => row.p50)) > Math.max(...otherPoints.map((row) => row.p50)));
});

test("annual seasonality requires twelve covered months and then lifts the peak month", () => {
  const rows = history("2024-01-01", 730, (_index, date) => (date.slice(5, 7) === "07" ? 40 : 10));
  const monthly = buildMonthlyIndex(rows);
  assert.ok(monthly);
  const july = monthly.find((row) => row.month === 7);
  assert.ok(july?.reliable);
  assert.ok((july?.index ?? 0) > 2);

  const shortRows = history("2026-01-01", 90, (_index, date) => (date.slice(5, 7) === "03" ? 40 : 10));
  const shortMonthly = buildMonthlyIndex(shortRows);
  assert.ok(shortMonthly);
  assert.ok(shortMonthly.every((row) => !row.reliable), "90 天历史不允许声称知道年度淡旺季");
});

test("event elasticity is applied only with enough historical instances", () => {
  const rows = history("2025-01-01", 400, (_index, date) => {
    const monthDay = date.slice(5);
    return monthDay >= "07-10" && monthDay <= "07-12" ? 30 : 10;
  });
  const events = [
    { id: "prime", label: "Prime Day", startDate: "2025-07-10", endDate: "2025-07-12" },
    { id: "prime", label: "Prime Day", startDate: "2026-07-10", endDate: "2026-07-12" },
  ];
  const adjustments = buildEventAdjustments(rows, events, { from: "2026-07-09", horizonDays: 6 });
  assert.equal(adjustments.length, 3);
  assert.ok(adjustments.every((row) => !row.reliable), "只有一个历史实例时不得外推弹性");
  assert.ok(adjustments.every((row) => row.multiplier === 1));

  const twoInstances = history("2024-01-01", 800, (_index, date) => {
    const monthDay = date.slice(5);
    return monthDay >= "07-10" && monthDay <= "07-12" ? 30 : 10;
  });
  const events2 = [
    { id: "prime", label: "Prime Day", startDate: "2024-07-10", endDate: "2024-07-12" },
    { id: "prime", label: "Prime Day", startDate: "2025-07-10", endDate: "2025-07-12" },
    { id: "prime", label: "Prime Day", startDate: "2026-07-10", endDate: "2026-07-12" },
  ];
  const applied = buildEventAdjustments(twoInstances, events2, { from: "2026-07-09", horizonDays: 6 });
  assert.ok(applied.some((row) => row.reliable && row.multiplier > 2));
});

test("new items require a manual rate and never borrow mature averages", () => {
  const rows = history("2026-01-01", 60, () => 10);
  const blocked = forecastDemand({ history: rows, asOf: "2026-03-02", horizonDays: 7, lifecycle: "NEW", newProductDailyUnits: null });
  assert.equal(blocked.status, "NEEDS_DATA");
  assert.ok(blocked.missingInputs.some((row) => row.includes("新品试销日需求")));

  const ready = forecastDemand({ history: rows, asOf: "2026-03-02", horizonDays: 3, lifecycle: "NEW", newProductDailyUnits: 4 });
  assert.equal(ready.status, "READY");
  assert.equal(ready.method, "MANUAL_NEW_ITEM");
  assert.equal(ready.points[0].p50, 4);
  assert.equal(ready.points[0].p90, 5.2);
  assert.equal(ready.confidence, "LOW");
});

test("trend is clamped so one promo week cannot project an exponential ramp", () => {
  const rows = history("2026-01-01", 120, (index) => (index > 100 ? 60 : 10));
  const fit = fitRobustLevel(rows, "2026-05-01");
  assert.ok(fit);
  assert.ok(fit.trendPerDay <= fit.level * 0.1 + 0.0001);
});

test("dense window reports gaps and keeps exact dates", () => {
  const rows = history("2026-03-01", 10, (index) => index);
  const dense = buildDenseWindow(rows, "2026-03-11", 10);
  assert.equal(dense.errors.length, 0);
  assert.equal(dense.observations.length, 10);
  assert.equal(dense.missingDates.length, 0);
  assert.equal(dense.observations[0].date, "2026-03-01");
  assert.equal(dense.observations[9].date, "2026-03-10");
});

test("walk-forward backtest scores a seasonal series and skips missing actuals", () => {
  const rows = history("2025-01-01", 540, (_index, date) => {
    const weekday = weekdayOf(date);
    return (weekday === 0 || weekday === 6 ? 14 : 10) + (date.slice(5, 7) === "11" ? 6 : 0);
  });
  const result = backtestForecast({
    history: rows,
    startDate: "2025-06-01",
    endDate: "2026-06-01",
    horizonDays: 7,
    stepDays: 7,
    minTrainDays: 60,
  });
  assert.ok(result.evaluatedPoints > 100);
  assert.ok(result.mape !== null && result.mape < 0.35, `MAPE 过高：${result.mape}`);
  assert.ok(result.p90Coverage !== null && result.p90Coverage >= 0.9, `P90 覆盖率不足：${result.p90Coverage}`);
  assert.ok(result.wape !== null && result.wape < 0.35);
  assert.equal(result.notes.some((row) => row.includes("不补零")), true);
});
