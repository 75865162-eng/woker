import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PEAK_INSIGHTS_CONFIG,
  SHIPPING_STATE_LABEL,
  buildPeakInsights,
  coefficientForMonth,
  evaluatePeakWarnings,
  identifyPeakMonths,
  identifySeasonWindows,
  parseMonthlyTarget,
  suggestWeightsFromHistory,
  totalLeadDays,
  type PeakInsightsConfig,
} from "@/lib/products/peak-season-planning";

const W = (weights: number[]) => weights;

function configWith(overrides: Partial<PeakInsightsConfig> = {}): PeakInsightsConfig {
  return {
    ...DEFAULT_PEAK_INSIGHTS_CONFIG,
    ...overrides,
    leadTime: { ...DEFAULT_PEAK_INSIGHTS_CONFIG.leadTime, ...(overrides.leadTime ?? {}) },
  };
}

// ---------- 峰值月份 ----------
test("峰值月份：单峰", () => {
  assert.deepEqual(identifyPeakMonths(W([10, 20, 30, 100, 30, 20, 10, 10, 10, 10, 10, 10])), [4]);
});

test("峰值月份：并列多峰", () => {
  assert.deepEqual(identifyPeakMonths(W([10, 10, 10, 10, 100, 100, 10, 10, 100, 10, 10, 10])), [5, 6, 9]);
});

test("峰值月份：非法输入返回空", () => {
  assert.deepEqual(identifyPeakMonths([1, 2, 3]), []);
  assert.deepEqual(identifyPeakMonths(W([10, 20, NaN, 10, 10, 10, 10, 10, 10, 10, 10, 10])), []);
});

// ---------- 旺季窗口 ----------
test("旺季窗口：识别多个连续区间", () => {
  // 4-6 春季旺季，8-10 秋季旺季；中间 7 月低权重不合并
  const windows = identifySeasonWindows(W([10, 10, 10, 80, 90, 80, 30, 80, 90, 80, 10, 10]), 60);
  assert.deepEqual(windows.map((w) => [w.startMonth, w.endMonth]), [[4, 6], [8, 10]]);
  assert.equal(windows[0].label, "4月–6月");
});

test("旺季窗口：边界月 12 月可闭合", () => {
  const windows = identifySeasonWindows(W([10, 10, 10, 10, 10, 10, 10, 10, 10, 70, 80, 90]), 60);
  assert.deepEqual(windows.map((w) => [w.startMonth, w.endMonth]), [[10, 12]]);
});

test("旺季窗口：无达标月份返回空", () => {
  assert.deepEqual(identifySeasonWindows(W(Array(12).fill(30)), 60), []);
});

// ---------- 目标销量 / 系数 / 物流 ----------
test("目标销量：解析与拒绝", () => {
  assert.equal(parseMonthlyTarget("100"), 100);
  assert.equal(parseMonthlyTarget("1,200"), 1200);
  assert.equal(parseMonthlyTarget(250), 250);
  assert.equal(parseMonthlyTarget(""), null);
  assert.equal(parseMonthlyTarget("abc"), null);
  assert.equal(parseMonthlyTarget("-5"), null);
});

test("需求系数：可配置且非法回退中性 1", () => {
  const cfg = configWith({ demandCoefficients: [0.5, 0.5, 0.5, 2, 2, 2, 1, 1, 1, 1, 1, 1] });
  assert.equal(coefficientForMonth(cfg, 4), 2);
  assert.equal(coefficientForMonth(cfg, 1), 0.5);
  const broken = configWith({ demandCoefficients: [NaN, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
  assert.equal(coefficientForMonth(broken, 1), 1);
});

test("物流总天数：任一环节缺失返回 null，不补零", () => {
  assert.equal(totalLeadDays(configWith()), null);
  assert.equal(totalLeadDays(configWith({ leadTime: { productionDays: 5, domesticDays: 3, oceanDays: 35, safetyDays: 7 } })), 50);
  assert.equal(totalLeadDays(configWith({ leadTime: { productionDays: 5, domesticDays: 3, oceanDays: null, safetyDays: 7 } })), null);
});

// ---------- 主计算 ----------
const FULL_CONFIG = configWith({ leadTime: { productionDays: 5, domesticDays: 3, oceanDays: 35, safetyDays: 7 } });

test("主计算：完整数据 → READY，备货量与发货日正确", () => {
  const weights = W([10, 10, 10, 80, 90, 80, 30, 80, 90, 80, 10, 10]);
  const result = buildPeakInsights({
    weights,
    monthlyTargetSales: "100",
    inboundUnits: 50,
    availableUnits: 120,
    shipmentCompleted: false,
    timeZone: "America/Los_Angeles",
    today: "2026-02-01",
    year: 2026,
    config: FULL_CONFIG,
  });
  assert.equal(result.status, "READY");
  assert.deepEqual(result.peakMonths, [5, 9]);
  assert.deepEqual(result.seasonWindows.map((w) => [w.startMonth, w.endMonth]), [[4, 6], [8, 10]]);
  // 覆盖月 4,5,6,8,9,10 系数默认 1.1,1.4,1.4,1.2,1.4,1.2 → 需求 110+140+140+120+140+120=770
  assert.equal(result.seasonalDemand, 770);
  assert.equal(result.suggestedShipment, 820); // 770 + 在途 50
  assert.equal(result.leadDays, 50);
  assert.equal(result.seasonStartDate, "2026-04-01");
  assert.equal(result.latestShippingDate, "2026-02-10"); // 4/1 减 50 天
  assert.equal(result.expectedReadyDate, "2026-04-01");
  // 2026-02-01 距 2026-02-10 为 9 天 → 预警
  assert.equal(result.daysToDeadline, 9);
  assert.equal(result.shippingState, "WARNING");
});

test("主计算：在途缺失 → 建议发货量 null 且 NEEDS_DATA，不伪造", () => {
  const result = buildPeakInsights({
    weights: W([10, 10, 10, 80, 90, 80, 30, 10, 10, 10, 10, 10]),
    monthlyTargetSales: "100",
    inboundUnits: null,
    availableUnits: null,
    shipmentCompleted: false,
    timeZone: "America/Los_Angeles",
    today: "2026-01-01",
    year: 2026,
    config: FULL_CONFIG,
  });
  assert.equal(result.status, "NEEDS_DATA");
  assert.equal(result.seasonalDemand, 390); // 4,5,6 月 110+140+140
  assert.equal(result.suggestedShipment, null);
  assert.ok(result.needs.some((n) => n.field === "inboundUnits"));
});

test("主计算：缺目标销量 → 需求 null，不补零", () => {
  const result = buildPeakInsights({
    weights: W([10, 10, 10, 80, 90, 80, 10, 10, 10, 10, 10, 10]),
    monthlyTargetSales: "",
    inboundUnits: 50,
    availableUnits: null,
    shipmentCompleted: false,
    timeZone: "America/Los_Angeles",
    today: "2026-01-01",
    year: 2026,
    config: FULL_CONFIG,
  });
  assert.equal(result.monthlyTarget, null);
  assert.equal(result.seasonalDemand, null);
  assert.equal(result.suggestedShipment, null);
  assert.ok(result.needs.some((n) => n.field === "monthlyTargetSales"));
});

test("主计算：时区/物流缺失 → 发货日 null，状态 UNKNOWN，不伪造日期", () => {
  const result = buildPeakInsights({
    weights: W([10, 10, 10, 80, 90, 80, 10, 10, 10, 10, 10, 10]),
    monthlyTargetSales: "100",
    inboundUnits: 50,
    availableUnits: null,
    shipmentCompleted: false,
    timeZone: null,
    today: "2026-01-01",
    year: 2026,
    config: DEFAULT_PEAK_INSIGHTS_CONFIG, // 物流全 null
  });
  assert.equal(result.latestShippingDate, null);
  assert.equal(result.shippingState, "UNKNOWN");
  assert.equal(SHIPPING_STATE_LABEL.UNKNOWN, "待接入");
  assert.ok(result.needs.some((n) => n.field === "timeZone"));
  assert.ok(result.needs.some((n) => n.field === "leadTime"));
});

test("主计算：发货状态分支 正常/紧急/已完成", () => {
  const weights = W([80, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]); // 旺季 1 月
  const base = {
    weights,
    monthlyTargetSales: "100",
    inboundUnits: 0,
    availableUnits: null,
    timeZone: "America/Los_Angeles",
    year: 2026,
    config: configWith({ leadTime: { productionDays: 0, domesticDays: 0, oceanDays: 30, safetyDays: 0 } }),
  };
  // 旺季 1/1，物流 30 天 → 最晚发货 2025-12-02
  const normal = buildPeakInsights({ ...base, today: "2025-11-01", shipmentCompleted: false });
  assert.equal(normal.shippingState, "NORMAL"); // 距 12/2 有 31 天
  const urgent = buildPeakInsights({ ...base, today: "2025-12-10", shipmentCompleted: false });
  assert.equal(urgent.shippingState, "URGENT"); // 已逾期
  const done = buildPeakInsights({ ...base, today: "2025-12-10", shipmentCompleted: true });
  assert.equal(done.shippingState, "COMPLETED");
});

test("主计算：无旺季窗口 → NEEDS_DATA，无虚构成果", () => {
  const result = buildPeakInsights({
    weights: W(Array(12).fill(10)),
    monthlyTargetSales: "100",
    inboundUnits: 50,
    availableUnits: null,
    shipmentCompleted: false,
    timeZone: "America/Los_Angeles",
    today: "2026-01-01",
    year: 2026,
    config: FULL_CONFIG,
  });
  assert.equal(result.status, "NEEDS_DATA");
  assert.equal(result.seasonalDemand, null);
  assert.equal(result.latestShippingDate, null);
  assert.ok(result.needs.some((n) => n.field === "seasonWindow"));
});

// ---------- 预警 ----------
test("预警：旺季临近 + 海运逾期", () => {
  const warnings = evaluatePeakWarnings({
    seasonStartDate: "2026-04-01",
    latestShippingDate: "2026-02-01",
    today: "2026-03-15", // 距旺季 17 天（<=30）→ 旺季临近；已过最晚发货日 2/1 → 逾期
    shipmentCompleted: false,
  });
  assert.ok(warnings.some((w) => w.kind === "SEASON_STARTING"));
  assert.ok(warnings.some((w) => w.kind === "SHIPPING_OVERDUE" && w.tone === "danger"));
});

test("预警：已完成发货不再报逾期", () => {
  const warnings = evaluatePeakWarnings({
    seasonStartDate: "2026-04-01",
    latestShippingDate: "2026-02-01",
    today: "2026-02-10",
    shipmentCompleted: true,
  });
  assert.equal(warnings.some((w) => w.kind === "SHIPPING_OVERDUE"), false);
});

// ---------- 历史销售 → 季节指数 → 权重建议（第八章）----------
test("历史分析：完整两年数据 → 可靠，指数与权重建议正确，不覆盖人工", () => {
  const observations: Array<{ date: string; units: number }> = [];
  // 2024+2025 每月 5 天；1月=10件/天(低谷)，7月=30件/天(高峰)，其余=20
  for (const year of [2024, 2025]) {
    for (let month = 1; month <= 12; month += 1) {
      const units = month === 1 ? 10 : month === 7 ? 30 : 20;
      for (const day of [1, 5, 10, 15, 20]) {
        observations.push({ date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, units });
      }
    }
  }
  const r = suggestWeightsFromHistory(observations, "sellfox_sales_daily / MSKU ABC");
  assert.equal(r.status, "READY");
  assert.equal(r.reliable, true);
  assert.equal(r.observationDays, 120);
  assert.deepEqual(r.years, [2024, 2025]);
  assert.equal(r.sourceNote, "sellfox_sales_daily / MSKU ABC");
  // 全期日均 = (1月2年*5天*10 + 7月2年*5天*30 + 其余10月*2年*5天*20)/120 = (100+300+2000)/120 = 20
  const jan = r.months.find((m) => m.month === 1)!;
  const jul = r.months.find((m) => m.month === 7)!;
  assert.equal(jan.index, 0.5); // 10/20
  assert.equal(jul.index, 1.5); // 30/20
  assert.deepEqual(r.peakMonths, [7]);
  assert.equal(r.suggestedWeights![0], 30); // 1/3*100=33→30
  assert.equal(r.suggestedWeights![6], 100); // 峰值
  // 仅生成建议，函数不接触人工权重（无副作用）
});

test("历史分析：样本不足/覆盖月份不足 → NEEDS_DATA，不生成权重建议", () => {
  const short: Array<{ date: string; units: number }> = [];
  for (let d = 1; d <= 10; d += 1) short.push({ date: `2025-01-${String(d).padStart(2, "0")}`, units: 5 });
  const r = suggestWeightsFromHistory(short, "新品");
  assert.equal(r.status, "NEEDS_DATA");
  assert.equal(r.reliable, false);
  assert.equal(r.suggestedWeights, null);
  assert.deepEqual(r.peakMonths, []);
  assert.ok(r.needs.some((n) => n.field === "history"));
});

test("历史分析：缺失月份不当零，index=1 且 reliable=false", () => {
  const observations: Array<{ date: string; units: number }> = [];
  // 只有 1-6 月数据，每月 10 天
  for (let month = 1; month <= 6; month += 1) {
    for (let day = 1; day <= 10; day += 1) {
      observations.push({ date: `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, units: 20 });
    }
  }
  const r = suggestWeightsFromHistory(observations, "半年新品");
  assert.equal(r.status, "NEEDS_DATA");
  const july = r.months.find((m) => m.month === 7)!;
  assert.equal(july.samples, 0);
  assert.equal(july.index, 1);
  assert.equal(july.reliable, false);
});

test("历史分析：歧义日与非法值剔除，不全零；重复日期当未知丢弃", () => {
  const observations: Array<{ date: string; units: number }> = [
    { date: "2025-01-01", units: 10 },
    { date: "2025-01-01", units: 99 }, // 重复 → 丢弃该日
    { date: "2025-01-02", units: -5 }, // 非法 → 剔除
    { date: "not-a-date", units: 10 }, // 非法日期 → 剔除
    { date: "2025-01-03", units: 10 },
  ];
  const r = suggestWeightsFromHistory(observations, "含脏数据");
  // 1/1 出现两次→按歧义丢弃；1/2 负值剔除；非法日期剔除；仅 1/3 有效
  assert.equal(r.observationDays, 1);
  assert.equal(r.months[0].samples, 1);
});
