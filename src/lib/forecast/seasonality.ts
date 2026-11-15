import {
  addDays,
  daysBetween,
  isoDate,
  median,
  monthOf,
  weekdayOf,
  type DemandObservation,
  type EventAdjustment,
  type MonthlyIndexEntry,
  type SeasonalEvent,
  type WeeklyIndexEntry,
} from "./types";

/**
 * Weekly pattern. Requires at least `minWeeks` occurrences of the same weekday,
 * otherwise the index is forced to 1 and flagged unreliable — a 10-day sample
 * cannot prove a Monday spike.
 */
export function buildWeeklyIndex(observations: DemandObservation[], minWeeks = 3): WeeklyIndexEntry[] | null {
  if (observations.length < 7) return null;
  const overall = observations.reduce((sum, row) => sum + row.units, 0) / observations.length;
  if (overall <= 0) return null;
  const buckets = new Map<number, number[]>();
  for (const row of observations) {
    const weekday = weekdayOf(row.date);
    const list = buckets.get(weekday) ?? [];
    list.push(row.units);
    buckets.set(weekday, list);
  }
  return Array.from({ length: 7 }, (_, weekday) => {
    const values = buckets.get(weekday) ?? [];
    const reliable = values.length >= minWeeks;
    const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : overall;
    return {
      weekday,
      index: reliable ? round4(mean / overall) : 1,
      samples: values.length,
      reliable,
    };
  });
}

/**
 * Monthly (annual seasonality) index. Needs at least `minPerMonth` samples for that
 * month and `minMonths` distinct months overall. Anything less returns `reliable:false`
 * so a 4-month history cannot claim to know the peak season.
 */
export function buildMonthlyIndex(observations: DemandObservation[], minPerMonth = 2, minMonths = 12): MonthlyIndexEntry[] | null {
  if (observations.length < 60) return null;
  const overall = observations.reduce((sum, row) => sum + row.units, 0) / observations.length;
  if (overall <= 0) return null;
  const buckets = new Map<number, number[]>();
  for (const row of observations) {
    const month = monthOf(row.date);
    const list = buckets.get(month) ?? [];
    list.push(row.units);
    buckets.set(month, list);
  }
  const coveredMonths = [...buckets.keys()].length;
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const values = buckets.get(month) ?? [];
    const reliable = coveredMonths >= minMonths && values.length >= minPerMonth;
    const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : overall;
    return { month, index: reliable ? round4(mean / overall) : 1, samples: values.length, reliable };
  });
}

/**
 * Event elasticity from historical instances of the same event id.
 * A window's lift is (actual total) / (baseline daily x window length).
 * Requires `minInstances` complete instances; otherwise multiplier is reported as
 * unknown and will not be applied.
 */
export function buildEventAdjustments(
  observations: DemandObservation[],
  events: SeasonalEvent[],
  horizon: { from: string; horizonDays: number },
  minInstances = 2,
): EventAdjustment[] {
  if (events.length === 0) return [];
  const byDate = new Map(observations.map((row) => [row.date, row.units]));
  const nonEventDates = new Set(observations.map((row) => row.date));
  const historicalEvents = events.filter((event) => event.endDate < horizon.from && isoDate(event.startDate) && isoDate(event.endDate));
  for (const event of historicalEvents) {
    for (let date = event.startDate; date <= event.endDate; date = addDays(date, 1)) nonEventDates.delete(date);
  }
  const baselineValues = [...nonEventDates].map((date) => byDate.get(date) ?? 0);
  const baseline = baselineValues.length > 0 ? baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length : null;

  const upcoming = events.filter((event) => event.endDate >= horizon.from && isoDate(event.startDate) && isoDate(event.endDate));
  const results: EventAdjustment[] = [];
  for (const event of upcoming) {
    const sameKind = historicalEvents.filter((past) => past.id === event.id);
    const days = daysBetween(event.startDate, event.endDate) + 1;
    for (let offset = 0; offset < horizon.horizonDays; offset += 1) {
      const date = addDays(horizon.from, offset);
      if (date < event.startDate || date > event.endDate) continue;
      if (baseline === null || baseline <= 0 || sameKind.length < minInstances) {
        results.push({
          eventId: event.id,
          label: event.label,
          date,
          multiplier: 1,
          basis: `UNKNOWN：基线不可用或历史实例 ${sameKind.length} 个（需 ${minInstances} 个），未应用事件弹性`,
          reliable: false,
        });
        continue;
      }
      const lifts: number[] = [];
      for (const past of sameKind) {
        const pastDays = daysBetween(past.startDate, past.endDate) + 1;
        let total = 0;
        let covered = true;
        for (let step = 0; step < pastDays; step += 1) {
          const pastDate = addDays(past.startDate, step);
          const value = byDate.get(pastDate);
          if (value === undefined) { covered = false; break; }
          total += value;
        }
        if (!covered) continue;
        lifts.push(total / (baseline * pastDays));
      }
      if (lifts.length < minInstances) {
        results.push({
          eventId: event.id,
          label: event.label,
          date,
          multiplier: 1,
          basis: `UNKNOWN：历史实例完整数据仅 ${lifts.length} 个（需 ${minInstances} 个），未应用事件弹性`,
          reliable: false,
        });
        continue;
      }
      const multiplier = round4(median(lifts) ?? 1);
      results.push({
        eventId: event.id,
        label: event.label,
        date,
        multiplier,
        basis: `${lifts.length} 个历史实例，中位弹性 ${multiplier}x（窗口 ${days} 天）`,
        reliable: true,
      });
    }
  }
  return results;
}

/** Multiplier for a given date combining weekly, monthly and event effects. */
export function seasonalMultiplierFor(date: string, weekly: WeeklyIndexEntry[] | null, monthly: MonthlyIndexEntry[] | null, events: EventAdjustment[]) {
  const weeklyEntry = weekly?.find((row) => row.weekday === weekdayOf(date));
  const monthlyEntry = monthly?.find((row) => row.month === monthOf(date));
  const eventEntry = events.find((row) => row.date === date);
  const multiplier = (weeklyEntry?.index ?? 1) * (monthlyEntry?.index ?? 1) * (eventEntry?.multiplier ?? 1);
  return round4(Math.max(0, multiplier));
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
