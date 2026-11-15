import { forecastDemand } from "./forecast";
import { addDays, daysBetween, type DemandObservation, type ForecastInput, type SeasonalEvent } from "./types";

export type BacktestPoint = {
  origin: string;
  date: string;
  actual: number;
  p50: number;
  p90: number;
  /** true when actual <= p90 (the interval covered the outcome). */
  covered: boolean;
};

export type BacktestOrigin = {
  origin: string;
  evaluatedDays: number;
  skippedDays: number;
  status: "READY" | "NEEDS_DATA";
  mape: number | null;
  wape: number | null;
};

export type BacktestResult = {
  version: "forecast-backtest-v1";
  origins: number;
  skippedOrigins: number;
  evaluatedPoints: number;
  skippedPoints: number;
  /** Mean absolute percentage error, only over non-zero actuals. */
  mape: number | null;
  /** Sum(|error|) / Sum(actual) — the metric to judge on when demand is intermittent. */
  wape: number | null;
  /** Mean signed error / mean actual. Positive means the model under-forecasts. */
  bias: number | null;
  /** Share of days where actual <= p90. Target >= 0.9 for a usable P90. */
  p90Coverage: number | null;
  perOrigin: BacktestOrigin[];
  points: BacktestPoint[];
  notes: string[];
};

/**
 * Walk-forward backtest. At every origin only data strictly before it is used,
 * mirroring production behaviour. Points without a complete actual are skipped,
 * never imputed.
 */
export function backtestForecast(input: {
  history: DemandObservation[];
  /** First origin date (YYYY-MM-DD). Training uses data before this date. */
  startDate: string;
  /** Last origin date (exclusive). */
  endDate: string;
  horizonDays: number;
  /** Days between origins. Defaults to horizonDays. */
  stepDays?: number;
  minTrainDays?: number;
  events?: SeasonalEvent[];
}): BacktestResult {
  const notes: string[] = [];
  const points: BacktestPoint[] = [];
  const perOrigin: BacktestOrigin[] = [];
  const step = Math.max(1, input.stepDays ?? input.horizonDays);
  const minTrainDays = input.minTrainDays ?? 28;
  const actualByDate = new Map(input.history.map((row) => [row.date, row.units]));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return {
      version: "forecast-backtest-v1",
      origins: 0, skippedOrigins: 0, evaluatedPoints: 0, skippedPoints: 0,
      mape: null, wape: null, bias: null, p90Coverage: null, perOrigin: [], points,
      notes: ["回测起止日期必须是 YYYY-MM-DD。"],
    };
  }

  let skippedOrigins = 0;
  let skippedPoints = 0;
  for (let origin = input.startDate; origin < input.endDate; origin = addDays(origin, step)) {
    const train = input.history.filter((row) => row.date < origin);
    const spanDays = train.length > 0 ? daysBetween(train[0].date, origin) : 0;
    if (spanDays < minTrainDays) { skippedOrigins += 1; continue; }

    const request: ForecastInput = {
      history: train,
      asOf: origin,
      horizonDays: input.horizonDays,
      events: input.events,
      lifecycle: "MATURE",
      minHistoryDays: minTrainDays,
    };
    const result = forecastDemand(request);
    if (result.status !== "READY") {
      skippedOrigins += 1;
      notes.push(`起点 ${origin} 训练失败：${result.missingInputs.join("；")}`);
      continue;
    }

    let evaluated = 0;
    let skipped = 0;
    let absoluteError = 0;
    let absolutePct = 0;
    let pctCount = 0;
    let actualTotal = 0;
    for (const point of result.points) {
      const actual = actualByDate.get(point.date);
      if (actual === undefined) { skipped += 1; skippedPoints += 1; continue; }
      const error = point.p50 - actual;
      absoluteError += Math.abs(error);
      actualTotal += actual;
      if (actual > 0) { absolutePct += Math.abs(error) / actual; pctCount += 1; }
      evaluated += 1;
      points.push({ origin, date: point.date, actual, p50: point.p50, p90: point.p90, covered: actual <= point.p90 });
    }

    if (evaluated === 0) { skippedOrigins += 1; continue; }
    perOrigin.push({
      origin,
      evaluatedDays: evaluated,
      skippedDays: skipped,
      status: "READY",
      mape: pctCount > 0 ? round4(absolutePct / pctCount) : null,
      wape: actualTotal > 0 ? round4(absoluteError / actualTotal) : null,
    });
  }

  if (points.length === 0) {
    notes.push("没有任何可评估的预测点：训练窗口不足或实际销量缺失。");
    return {
      version: "forecast-backtest-v1",
      origins: 0, skippedOrigins, evaluatedPoints: 0, skippedPoints: 0,
      mape: null, wape: null, bias: null, p90Coverage: null, perOrigin, points,
      notes,
    };
  }

  let absoluteError = 0;
  let absolutePct = 0;
  let pctCount = 0;
  let signedError = 0;
  let actualTotal = 0;
  let coveredCount = 0;
  for (const point of points) {
    const error = point.p50 - point.actual;
    absoluteError += Math.abs(error);
    signedError += error;
    actualTotal += point.actual;
    if (point.actual > 0) { absolutePct += Math.abs(error) / point.actual; pctCount += 1; }
    if (point.covered) coveredCount += 1;
  }

  notes.push(`共 ${points.length} 个评估点，跳过 ${skippedPoints} 个缺失实际值（不补零）。`);
  if (skippedOrigins > 0) notes.push(`${skippedOrigins} 个起点因训练窗口不足被跳过。`);

  return {
    version: "forecast-backtest-v1",
    origins: perOrigin.length,
    skippedOrigins,
    evaluatedPoints: points.length,
    skippedPoints,
    mape: pctCount > 0 ? round4(absolutePct / pctCount) : null,
    wape: actualTotal > 0 ? round4(absoluteError / actualTotal) : null,
    bias: actualTotal > 0 ? round4(signedError / actualTotal) : null,
    p90Coverage: round4(coveredCount / points.length),
    perOrigin,
    points,
    notes,
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
