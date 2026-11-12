export type CompleteHistoryWindow = { from: string; to: string };

const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Return one bounded internal gap. Uncovered leading history stays with forward backfill. */
export function nextInternalWindowGap(initialFrom: string, coveredThrough: string, windows: CompleteHistoryWindow[], maxWindowMs: number): CompleteHistoryWindow | null {
  const start = instant(initialFrom), end = instant(coveredThrough);
  if (start === null || end === null || end <= start || !Number.isSafeInteger(maxWindowMs) || maxWindowMs < 1) return null;
  const ranges = windows.flatMap(window => {
    const from = instant(window.from), to = instant(window.to);
    if (from === null || to === null || to <= from || to <= start || from >= end) return [];
    return [{ from: Math.max(start, from), to: Math.min(end, to) }];
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  if (ranges.length < 2) return null;
  let through = ranges[0].to;
  for (let index = 1; index < ranges.length; index++) {
    const next = ranges[index];
    if (next.from > through) {
      const to = Math.min(next.from, through + maxWindowMs, end);
      if (to > through) return { from: new Date(through).toISOString(), to: new Date(to).toISOString() };
    }
    through = Math.max(through, next.to);
  }
  return null;
}
