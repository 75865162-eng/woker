import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCarryover,
  formatPeriodLabel,
  nextPeriodKey,
  periodKeyOf,
  periodRange,
  previousPeriodKey,
  startOfDayInZone,
  zonedTimeToUtc,
} from "@/lib/points/period";

test("periodKeyOf 按组织时区划分自然月，不受服务器时区影响", () => {
  // 2026-10-31 23:30 UTC = 2026-11-01 07:30 上海 → 属于 11 月
  assert.equal(periodKeyOf(new Date("2026-10-31T23:30:00Z"), "Asia/Shanghai"), "2026-11");

  // 2026-10-31 15:59 UTC = 2026-10-31 23:59 上海 → 仍属 10 月
  assert.equal(periodKeyOf(new Date("2026-10-31T15:59:00Z"), "Asia/Shanghai"), "2026-10");

  // 同一时刻在 UTC 时区下是 10 月
  assert.equal(periodKeyOf(new Date("2026-10-31T23:30:00Z"), "UTC"), "2026-10");
});

test("periodRange 给出上海时区的月初与月末时刻", () => {
  const { start, end } = periodRange("2026-11", "Asia/Shanghai");

  assert.equal(start.toISOString(), "2026-10-31T16:00:00.000Z");
  // 12 月 1 日 00:00 上海 = 11 月 30 日 16:00 UTC，减 1 毫秒
  assert.equal(end.toISOString(), "2026-11-30T15:59:59.999Z");
  assert.equal(periodKeyOf(end, "Asia/Shanghai"), "2026-11");
  assert.equal(periodKeyOf(new Date(end.getTime() + 1), "Asia/Shanghai"), "2026-12");
});

test("periodRange 跨年正确", () => {
  const { start, end } = periodRange("2026-12", "Asia/Shanghai");

  assert.equal(start.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(periodKeyOf(new Date(end.getTime() + 1), "Asia/Shanghai"), "2027-01");
});

test("period 前后推移跨年", () => {
  assert.equal(previousPeriodKey("2026-01"), "2025-12");
  assert.equal(previousPeriodKey("2026-11"), "2026-10");
  assert.equal(nextPeriodKey("2026-12"), "2027-01");
  assert.equal(nextPeriodKey("2026-11"), "2026-12");
});

test("结转上限硬顶，且不会出现负数", () => {
  assert.equal(computeCarryover(30, 50), 30);
  assert.equal(computeCarryover(80, 50), 50);
  assert.equal(computeCarryover(0, 50), 0);
  assert.equal(computeCarryover(30, 0), 0);
  assert.equal(computeCarryover(-10, 50), 0);
  assert.equal(computeCarryover(Number.NaN, 50), 0);
});

test("单月可用上限是 100：50 基础 + 50 结转，且结转额不再二次结转", () => {
  // 第 1 月：用掉 0，剩 50
  const month1Remaining = 50;
  const carriedIntoMonth2 = computeCarryover(month1Remaining, 50);
  assert.equal(carriedIntoMonth2, 50);

  // 第 2 月可用 = 50 基础 + 50 结转 = 100，但只有基础部分能结转
  const month2Base = 50;
  const month2Total = month2Base + carriedIntoMonth2;
  assert.equal(month2Total, 100);

  // 第 2 月一点没用，第 3 月最多还是结转 50（结转额本身不可再结转）
  const carriedIntoMonth3 = computeCarryover(month2Base, 50);
  assert.equal(carriedIntoMonth3, 50);
  assert.equal(month2Base + carriedIntoMonth3, 100);
});

test("startOfDayInZone 取组织时区当天零点", () => {
  const noonShanghai = new Date("2026-11-14T04:00:00Z");
  const start = startOfDayInZone(noonShanghai, "Asia/Shanghai");

  assert.equal(start.toISOString(), "2026-11-13T16:00:00.000Z");
  assert.equal(periodKeyOf(start, "Asia/Shanghai"), "2026-11");
});

test("zonedTimeToUtc 与 Intl 往返一致", () => {
  const utc = zonedTimeToUtc(2026, 3, 15, 0, "Asia/Shanghai");
  assert.equal(periodKeyOf(utc, "Asia/Shanghai"), "2026-03");
});

test("周期标签用于 UI", () => {
  assert.equal(formatPeriodLabel("2026-11"), "2026 年 11 月");
  assert.equal(formatPeriodLabel("2027-01"), "2027 年 1 月");
});
