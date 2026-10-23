import type { SalesDay } from "./replenishment";

/** Existing imports normalize missing numbers to 0, so inspect original presence.
 * Ambiguous multi-SKU rows and duplicated dates must not be added together.
 */
export function extractHistoricalSales(rows: { reportDate: string; msku: string; payload: unknown }[], sellerSku: string): SalesDay[] {
  const days = new Map<string, number | null>();
  for (const row of rows) {
    if (row.msku !== sellerSku) continue;
    if (days.has(row.reportDate)) { days.set(row.reportDate, null); continue; }
    const raw = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>).saleNum : undefined;
    const units = typeof raw === "number" || (typeof raw === "string" && /^\d+(?:\.0+)?$/.test(raw.trim())) ? Number(raw) : NaN;
    days.set(row.reportDate, Number.isInteger(units) && units >= 0 ? units : null);
  }
  return [...days].filter((entry): entry is [string, number] => entry[1] !== null).map(([date, units]) => ({ date, units }));
}
