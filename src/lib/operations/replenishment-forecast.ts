import { forecastDemand, type ForecastResult, type SeasonalEvent } from "@/lib/forecast";
import type { DemandForecastInput, SalesDay } from "./replenishment";

/**
 * Bridges raw daily sales into the statistical forecast consumed by replenishment.
 *
 * Contract:
 * - Never invents demand. If the history is too short, has gaps, or is zero, this
 *   returns `forecast: null` and the caller falls back to the deterministic
 *   28-day / Wimoor model with an explicit reason.
 * - P50/P90 are horizon averages, not a single day, so a seasonal peak inside the
 *   horizon raises the buffer instead of being averaged away.
 */
export type ReplenishmentForecast = {
  forecast: DemandForecastInput | null;
  /** Machine-readable status for logs and the plan snapshot. */
  status: "APPLIED" | "SKIPPED";
  /** Human-readable reason; always populated. */
  note: string;
  detail: {
    method: string | null;
    confidence: string | null;
    horizonDays: number;
    historyDays: number;
    horizonP50Total: number | null;
    horizonP90Total: number | null;
    missingInputs: string[];
  };
};

export function buildReplenishmentDemandForecast(input: {
  salesHistory: SalesDay[];
  /** Calculation anchor: normally today (Asia/Shanghai). History on/after it is ignored. */
  asOf: string;
  horizonDays: number;
  events?: SeasonalEvent[];
  minHistoryDays?: number;
}): ReplenishmentForecast {
  const horizonDays = Math.max(1, Math.min(730, Math.ceil(input.horizonDays)));
  const empty: ReplenishmentForecast = {
    forecast: null,
    status: "SKIPPED",
    note: "",
    detail: {
      method: null,
      confidence: null,
      horizonDays,
      historyDays: input.salesHistory.length,
      horizonP50Total: null,
      horizonP90Total: null,
      missingInputs: [],
    },
  };

  if (input.salesHistory.length === 0) {
    return { ...empty, note: "无销量历史：未启用预测，沿用确定性日需模型。" };
  }

  let result: ForecastResult;
  try {
    result = forecastDemand({
      history: input.salesHistory.map((row) => ({ date: row.date, units: row.units })),
      asOf: input.asOf,
      horizonDays,
      events: input.events,
      lifecycle: "MATURE",
      minHistoryDays: input.minHistoryDays ?? 56,
    });
  } catch (error) {
    return {
      ...empty,
      note: `预测层未能计算（${error instanceof Error ? error.message : "未知错误"}）：未启用预测，沿用确定性日需模型。`,
    };
  }

  const detail = {
    ...empty.detail,
    method: result.method,
    confidence: result.confidence,
    horizonP50Total: result.horizonP50Total,
    horizonP90Total: result.horizonP90Total,
    missingInputs: result.missingInputs,
  };

  if (result.status !== "READY" || result.horizonP50Total === null || result.horizonP90Total === null) {
    const why = result.missingInputs.length ? result.missingInputs.join("；") : `状态 ${result.status}`;
    return { ...empty, detail, note: `预测条件不足（${why}）：未启用预测，沿用确定性日需模型。` };
  }

  const p50Daily = round4(result.horizonP50Total / horizonDays);
  const p90Daily = round4(result.horizonP90Total / horizonDays);
  if (!(p50Daily > 0) || p90Daily < p50Daily) {
    return { ...empty, detail, note: `预测区间无效（P50 ${p50Daily}，P90 ${p90Daily}）：未启用预测，沿用确定性日需模型。` };
  }

  return {
    forecast: {
      p50Daily,
      p90Daily,
      method: result.method ?? "forecast-v1",
      confidence: result.confidence,
      asOf: input.asOf,
    },
    status: "APPLIED",
    note: `预测层已启用：${result.method ?? "forecast-v1"}，P50 ${p50Daily}/日、P90 ${p90Daily}/日，覆盖 ${horizonDays} 天，置信 ${result.confidence}。`,
    detail,
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
