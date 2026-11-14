/**
 * Deterministic demand forecasting primitives.
 *
 * Hard rules (must not be relaxed):
 * - Missing days are never treated as zero demand; a gap blocks the result.
 * - Every number produced here is reproducible from the given history only.
 * - Seasonality/event multipliers are emitted with their sample basis; unknown basis yields `null`, never a guess.
 */

export type DemandObservation = { date: string; units: number };

export type SeasonalEvent = {
  id: string;
  label: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  endDate: string;
};

export type ForecastStatus = "READY" | "NEEDS_DATA";

export type ForecastConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type ForecastMethod =
  | "HOLT_LINEAR_SEASONAL"
  | "HOLT_LINEAR"
  | "ROBUST_LEVEL"
  | "MANUAL_NEW_ITEM";

export type DemandPoint = {
  date: string;
  /** Median (P50) daily demand estimate. */
  p50: number;
  /** 90th percentile daily demand estimate, always >= p50. */
  p90: number;
};

export type WeeklyIndexEntry = {
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
  index: number;
  samples: number;
  /** false when samples are insufficient; index is forced to 1. */
  reliable: boolean;
};

export type MonthlyIndexEntry = {
  /** 1 = January .. 12 = December. */
  month: number;
  index: number;
  samples: number;
  reliable: boolean;
};

export type EventAdjustment = {
  eventId: string;
  label: string;
  date: string;
  multiplier: number;
  /** How the multiplier was derived, e.g. "2 historical instances, 5.1x" or "UNKNOWN (0 instances)". */
  basis: string;
  reliable: boolean;
};

export type ForecastInput = {
  /** Observations keyed by date. Order does not matter; duplicates are rejected. */
  history: DemandObservation[];
  /** Calculation anchor; observations on or after this date are ignored. */
  asOf: string;
  /** Number of upcoming days to emit. */
  horizonDays: number;
  /** Full ISO dates (YYYY-MM-DD) of events; historical instances are used to fit elasticity. */
  events?: SeasonalEvent[];
  /** New items have no mature history; caller supplies a manual daily rate. */
  lifecycle?: "NEW" | "MATURE";
  newProductDailyUnits?: number | null;
  /** Minimum complete days required before a statistical forecast is produced. */
  minHistoryDays?: number;
};

export type ForecastResult = {
  version: "forecast-v1";
  status: ForecastStatus;
  method: ForecastMethod | null;
  asOf: string;
  horizonDays: number;
  /** Base daily level before weekly/monthly/event adjustments. */
  baseDailyP50: number | null;
  /** Trend per day, clamped so a noisy week cannot invent an explosive ramp. */
  trendPerDay: number | null;
  weeklyIndex: WeeklyIndexEntry[] | null;
  monthlyIndex: MonthlyIndexEntry[] | null;
  eventAdjustments: EventAdjustment[];
  residualSigma: number | null;
  /** Coefficient of variation of historical demand; drives confidence. */
  coefficientOfVariation: number | null;
  confidence: ForecastConfidence;
  points: DemandPoint[];
  /** Sum of P50 over the horizon. */
  horizonP50Total: number | null;
  horizonP90Total: number | null;
  reasons: string[];
  missingInputs: string[];
};

const DAY_MS = 86_400_000;

export const isoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + Math.round(days) * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

export const monthOf = (date: string) => Number(date.slice(5, 7));

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation scaled to a normal-equivalent sigma. Robust to promo spikes. */
export function robustSigma(residuals: number[]): number | null {
  const centre = median(residuals);
  if (centre === null) return null;
  const mad = median(residuals.map((value) => Math.abs(value - centre)));
  if (mad === null) return null;
  return mad * 1.4826;
}

/** Theil-Sen slope: median of pairwise slopes. Immune to single-day spikes. */
export function theilSenSlope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j].x - points[i].x;
      if (dx === 0) continue;
      slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return median(slopes);
}

/**
 * Sort + validate. Returns a dense map only when the window is fully covered.
 * A single missing day inside the window is reported, never filled with zero.
 */
export function buildDenseWindow(history: DemandObservation[], asOf: string, windowDays: number) {
  const errors: string[] = [];
  let previous: string | null = null;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    if (!isoDate(row.date)) errors.push(`无效销量日期：${String(row.date)}`);
    if (!Number.isFinite(row.units) || row.units < 0) errors.push(`无效销量：${row.date}`);
    if (previous === row.date) errors.push(`重复销量日期：${row.date}`);
    previous = row.date;
  }
  if (errors.length > 0) return { errors, observations: [] as DemandObservation[], missingDates: [] as string[] };

  const cutoffStart = addDays(asOf, -windowDays);
  const inWindow = sorted.filter((row) => row.date >= cutoffStart && row.date < asOf);
  const byDate = new Map(inWindow.map((row) => [row.date, row.units]));
  const missingDates: string[] = [];
  const observations: DemandObservation[] = [];
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = addDays(cutoffStart, offset);
    const units = byDate.get(date);
    if (units === undefined) missingDates.push(date);
    else observations.push({ date, units });
  }
  return { errors, observations, missingDates };
}
