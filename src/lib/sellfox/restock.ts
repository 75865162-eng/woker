import { sellfoxInTransitStatuses } from "./fba-shipment-contract";

export const restockPrepDays = 30;
export const restockSafetyDays = 7;
const weights = { d7: 0.5, d14: 0.3, d30: 0.2 } as const;

export type RestockDay = { date: string; quantity: number | null; stockout?: boolean };

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

/** Recent two Shanghai calendar days are dropped. Stockout and missing days are left out of the divisor. */
export function restockDailyRates(days: RestockDay[], today: string) {
  const end = addDays(today, -2);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const rate = (span: number) => {
    let sum = 0;
    let count = 0;
    for (const date of datesBetween(addDays(end, -(span - 1)), end)) {
      const day = byDate.get(date);
      if (!day || day.stockout || day.quantity == null) continue;
      sum += day.quantity;
      count += 1;
    }
    return count === 0 ? null : sum / count;
  };
  const avg7 = rate(7);
  const avg14 = rate(14);
  const avg30 = rate(30);
  const weighted = avg7 == null || avg14 == null || avg30 == null ? null : avg7 * weights.d7 + avg14 * weights.d14 + avg30 * weights.d30;
  return { avg7, avg14, avg30, weighted };
}

export function mergeRestockDays(rows: RestockDay[]): RestockDay[] {
  const grouped = new Map<string, RestockDay[]>();
  for (const row of rows) grouped.set(row.date, [...(grouped.get(row.date) ?? []), row]);
  const merged: RestockDay[] = [];
  for (const [date, items] of grouped) {
    const observed = items.filter((item) => !item.stockout && item.quantity != null);
    if (observed.length) merged.push({ date, quantity: observed.reduce((sum, item) => sum + Number(item.quantity), 0), stockout: false });
    else if (items.some((item) => item.stockout)) merged.push({ date, quantity: null, stockout: true });
  }
  return merged;
}

export function inboundUnits(lines: { status: string; declaredQty: number | null; receivedQty: number | null }[]) {
  const open = lines.filter((line) => (sellfoxInTransitStatuses as readonly string[]).includes(line.status));
  if (open.some((line) => line.declaredQty == null || line.receivedQty == null)) return null;
  return open.reduce((sum, line) => sum + Math.max(0, Number(line.declaredQty) - Number(line.receivedQty)), 0);
}

/** 建议补货量 = max(0, (备货天数 + 安全天数) * 加权日均 - (可售 + 在途)). Missing inputs stay null. */
export function suggestRestockQuantity(input: {
  fulfillable: number | null;
  inTransit: number | null;
  daily: number | null;
  prepDays?: number;
  safetyDays?: number;
}) {
  if (input.fulfillable == null || input.inTransit == null || input.daily == null) return null;
  const cover = (input.prepDays ?? restockPrepDays) + (input.safetyDays ?? restockSafetyDays);
  return Math.round(Math.max(0, cover * input.daily - (input.fulfillable + input.inTransit)));
}

export function suggestRestockDate(today: string, quantity: number | null, prepDays = restockPrepDays) {
  return quantity != null && quantity > 0 ? addDays(today, prepDays) : null;
}

export function sumKnown(values: Array<number | null>) {
  return values.some((value) => value == null) ? null : values.reduce<number>((sum, value) => sum + Number(value), 0);
}
