import { buildEventAdjustments, buildMonthlyIndex, buildWeeklyIndex, seasonalMultiplierFor } from "./seasonality";
import {
  addDays,
  buildDenseWindow,
  daysBetween,
  isoDate,
  median,
  robustSigma,
  theilSenSlope,
  weekdayOf,
  type DemandPoint,
  type ForecastInput,
  type ForecastMethod,
  type ForecastResult,
  type ForecastStatus,
  type ForecastConfidence,
} from "./types";

const Z90 = 1.2815515655;
const LEVEL_LOOKBACK_DAYS = 14;
const TREND_LOOKBACK_DAYS = 56;
const MAX_TREND_RATIO = 0.1;

type LevelFit = { level: number; trendPerDay: number; sigma: number; sampleDays: number };

/**
 * Robust level + trend. Level is the median of the last 14 days (spike resistant),
 * trend is Theil-Sen over the last 56 days, clamped to +-10% of level per day so a
 * short promo burst cannot project an exponential ramp.
 */
export function fitRobustLevel(observations: Array<{ date: string; units: number }>, asOf: string): LevelFit | null {
  if (observations.length === 0) return null;
  const latest = addDays(asOf, -1);
  const levelRows = observations.filter((row) => row.date >= addDays(latest, -(LEVEL_LOOKBACK_DAYS - 1)) && row.date <= latest);
  const level = median(levelRows.length > 0 ? levelRows.map((row) => row.units) : observations.map((row) => row.units));
  if (level === null) return null;

  const trendRows = observations.filter((row) => row.date >= addDays(latest, -(TREND_LOOKBACK_DAYS - 1)) && row.date <= latest);
  const anchor = trendRows.length > 0 ? trendRows[0].date : observations[0].date;
  const rawSlope = theilSenSlope(trendRows.map((row) => ({ x: daysBetween(anchor, row.date), y: row.units })));
  const limit = Math.max(level * MAX_TREND_RATIO, 0.0001);
  const trendPerDay = rawSlope === null ? 0 : Math.max(-limit, Math.min(limit, rawSlope));

  const residuals = trendRows.map((row) => row.units - (level + trendPerDay * daysBetween(anchor, row.date)));
  // MAD collapses to 0 for bimodal residuals (e.g. weekday 0 / weekend 4), which would
  // produce a zero-width P90 band. Fall back to the mean absolute deviation converted
  // to a normal-equivalent sigma and keep the larger of the two.
  const madSigma = robustSigma(residuals) ?? 0;
  const meanAbsDeviation = residuals.length > 0 ? residuals.reduce((sum, value) => sum + Math.abs(value), 0) / residuals.length : 0;
  const sigma = Math.max(madSigma, meanAbsDeviation * 1.2533);

  return { level: Math.max(0, level), trendPerDay, sigma, sampleDays: observations.length };
}

function resolveConfidence(input: {
  sampleDays: number;
  coefficientOfVariation: number;
  hasReliableMonthly: boolean;
  hasReliableWeekly: boolean;
}): ForecastConfidence {
  const { sampleDays, coefficientOfVariation, hasReliableMonthly, hasReliableWeekly } = input;
  if (sampleDays < 28) return "LOW";
  if (coefficientOfVariation > 1.2) return "LOW";
  if (sampleDays >= 180 && hasReliableMonthly && coefficientOfVariation <= 0.6) return "HIGH";
  if (hasReliableWeekly && coefficientOfVariation <= 0.8) return "MEDIUM";
  return "MEDIUM";
}

export function forecastDemand(input: ForecastInput): ForecastResult {
  const reasons: string[] = [];
  const missingInputs: string[] = [];
  const empty = (status: ForecastStatus = "NEEDS_DATA"): ForecastResult => ({
    version: "forecast-v1",
    status,
    method: null,
    asOf: input.asOf,
    horizonDays: input.horizonDays,
    baseDailyP50: null,
    trendPerDay: null,
    weeklyIndex: null,
    monthlyIndex: null,
    eventAdjustments: [],
    residualSigma: null,
    coefficientOfVariation: null,
    confidence: "UNKNOWN",
    points: [],
    horizonP50Total: null,
    horizonP90Total: null,
    reasons,
    missingInputs,
  });

  if (!isoDate(input.asOf)) { missingInputs.push("计算基准日（YYYY-MM-DD）"); return empty(); }
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 365) {
    missingInputs.push("预测天数（1-365 的整数）");
    return empty();
  }
  const minHistoryDays = input.minHistoryDays ?? 28;
  const horizonFrom = input.asOf;

  if (input.lifecycle === "NEW") {
    if (input.newProductDailyUnits === null || input.newProductDailyUnits === undefined || !Number.isFinite(input.newProductDailyUnits) || input.newProductDailyUnits <= 0) {
      missingInputs.push("新品试销日需求（人工维护，不以短期销量外推）");
      return empty();
    }
    const daily = input.newProductDailyUnits;
    const points: DemandPoint[] = Array.from({ length: input.horizonDays }, (_, offset) => {
      const date = addDays(horizonFrom, offset);
      return { date, p50: round2(daily), p90: round2(daily * 1.3) };
    });
    reasons.push("新品采用人工维护的试销日需求；P90 按 1.3 倍保守上浮，不作统计外推。");
    return {
      ...empty("READY"),
      method: "MANUAL_NEW_ITEM",
      baseDailyP50: round2(daily),
      trendPerDay: 0,
      confidence: "LOW",
      points,
      horizonP50Total: round2(daily * input.horizonDays),
      horizonP90Total: round2(daily * 1.3 * input.horizonDays),
    };
  }

  const history = input.history.filter((row) => row.date < input.asOf);
  if (history.length === 0) { missingInputs.push("销量历史"); return empty(); }
  const spanDays = Math.min(366, daysBetween(history[0].date, input.asOf));
  const windowDays = Math.max(minHistoryDays, Math.min(spanDays, 366));
  const dense = buildDenseWindow(history, input.asOf, windowDays);
  if (dense.errors.length > 0) {
    reasons.push(...dense.errors.slice(0, 5));
    return empty();
  }
  if (dense.observations.length < minHistoryDays) {
    missingInputs.push(`完整销量历史 ${minHistoryDays} 天（当前 ${dense.observations.length} 天）`);
  }
  if (dense.missingDates.length > 0) {
    const preview = dense.missingDates.slice(0, 5).join("、");
    missingInputs.push(`连续销量日（缺 ${dense.missingDates.length} 天：${preview}${dense.missingDates.length > 5 ? " 等" : ""}；缺日不视为零）`);
  }
  if (missingInputs.length > 0) return empty();

  const weekly = buildWeeklyIndex(dense.observations);
  const monthly = buildMonthlyIndex(dense.observations);

  // Deseasonalise BEFORE fitting level/trend/sigma. Otherwise the residual sigma
  // absorbs the weekly/annual swing, and P90 becomes both too wide on quiet days and
  // too narrow on peak days (double counting the seasonal term).
  const deseasonalised = dense.observations.map((row) => {
    const weekdayEntry = weekly?.find((entry) => entry.weekday === weekdayOf(row.date));
    const monthEntry = monthly?.find((entry) => entry.month === Number(row.date.slice(5, 7)));
    const divisor = (weekdayEntry?.reliable ? weekdayEntry.index : 1) * (monthEntry?.reliable ? monthEntry.index : 1);
    return { date: row.date, units: divisor > 0 ? row.units / divisor : row.units };
  });

  const fit = fitRobustLevel(deseasonalised, input.asOf);
  if (!fit) { missingInputs.push("可拟合的销量水平"); return empty(); }

  const eventAdjustments = buildEventAdjustments(dense.observations, input.events ?? [], { from: horizonFrom, horizonDays: input.horizonDays });

  const method: ForecastMethod = monthly?.some((row) => row.reliable)
    ? "HOLT_LINEAR_SEASONAL"
    : weekly?.some((row) => row.reliable)
      ? "HOLT_LINEAR"
      : "ROBUST_LEVEL";

  const points: DemandPoint[] = [];
  let totalP50 = 0;
  let totalP90 = 0;
  for (let offset = 0; offset < input.horizonDays; offset += 1) {
    const date = addDays(horizonFrom, offset);
    const trended = Math.max(0, fit.level + fit.trendPerDay * (offset + 1));
    const multiplier = seasonalMultiplierFor(date, weekly, monthly, eventAdjustments);
    const p50 = trended * multiplier;
    const p90 = (trended + Z90 * fit.sigma) * multiplier;
    points.push({ date, p50: round2(p50), p90: round2(Math.max(p50, p90)) });
    totalP50 += p50;
    totalP90 += Math.max(p50, p90);
  }

  const coefficientOfVariation = fit.level > 0 ? fit.sigma / fit.level : null;
  const hasReliableMonthly = Boolean(monthly?.some((row) => row.reliable));
  const hasReliableWeekly = Boolean(weekly?.some((row) => row.reliable));
  const confidence = resolveConfidence({
    sampleDays: fit.sampleDays,
    coefficientOfVariation: coefficientOfVariation ?? 1,
    hasReliableMonthly,
    hasReliableWeekly,
  });

  reasons.push(`样本 ${fit.sampleDays} 天；水平 ${round2(fit.level)}/天（最近 ${LEVEL_LOOKBACK_DAYS} 天中位数），趋势 ${round2(fit.trendPerDay)}/天（上限 ±${(MAX_TREND_RATIO * 100).toFixed(0)}%）。`);
  reasons.push(`方法 ${method}；残差 σ=${round2(fit.sigma)}，P90 采用 ${Z90.toFixed(2)}σ 上浮。`);
  if (hasReliableWeekly) reasons.push("周内效应已应用（同一星期样本 ≥3 周）。");
  else reasons.push("周内效应未达样本要求，未应用。");
  if (hasReliableMonthly) {
    const peak = [...(monthly ?? [])].filter((row) => row.reliable).sort((a, b) => b.index - a.index)[0];
    const trough = [...(monthly ?? [])].filter((row) => row.reliable).sort((a, b) => a.index - b.index)[0];
    reasons.push(`年度季节性已应用：峰值月 ${peak.month} 月指数 ${peak.index}，谷值月 ${trough.month} 月指数 ${trough.index}。`);
  } else {
    reasons.push("年度季节性未应用：历史不足 12 个月或同月样本 <2，淡旺季不做推断。");
  }
  const unreliableEvents = eventAdjustments.filter((row) => !row.reliable);
  if (unreliableEvents.length > 0) reasons.push(`${new Set(unreliableEvents.map((row) => row.eventId)).size} 个促销事件因历史实例不足未应用弹性。`);
  if (eventAdjustments.some((row) => row.reliable)) reasons.push(`${new Set(eventAdjustments.filter((row) => row.reliable).map((row) => row.eventId)).size} 个促销事件已按历史弹性上调需求。`);

  return {
    version: "forecast-v1",
    status: "READY",
    method,
    asOf: input.asOf,
    horizonDays: input.horizonDays,
    baseDailyP50: round2(fit.level),
    trendPerDay: round2(fit.trendPerDay),
    weeklyIndex: weekly,
    monthlyIndex: monthly,
    eventAdjustments,
    residualSigma: round2(fit.sigma),
    coefficientOfVariation: coefficientOfVariation === null ? null : round4(coefficientOfVariation),
    confidence,
    points,
    horizonP50Total: round2(totalP50),
    horizonP90Total: round2(totalP90),
    reasons,
    missingInputs,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export { addDays, isoDate };
export type { DemandPoint, ForecastInput, ForecastResult } from "./types";
