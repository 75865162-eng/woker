import type { SalesDay } from "./replenishment";

/** Only complete MSKU daily sales are observations; missing days stay absent.
 * Internal SKU is deliberately irrelevant, including when it is empty.
 */
export function extractHistoricalSales(rows: { reportDate: string; msku: string; quantity: number | null; complete: boolean }[], sellerSku: string): SalesDay[] {
  if (!sellerSku.trim()) return [];
  const days = new Map<string, number | null>();
  for (const row of rows) {
    if (row.msku !== sellerSku) continue;
    if (days.has(row.reportDate)) { days.set(row.reportDate, null); continue; }
    const units = row.quantity;
    days.set(row.reportDate, row.complete && units !== null && Number.isInteger(units) && units >= 0 ? units : null);
  }
  return [...days].filter((entry): entry is [string, number] => entry[1] !== null).map(([date, units]) => ({ date, units }));
}
