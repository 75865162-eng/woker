export const sellfoxSyncResources = ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report"] as const;
export type SellfoxSyncResource = (typeof sellfoxSyncResources)[number];

export function isSellfoxSyncResource(value: unknown): value is SellfoxSyncResource {
  return typeof value === "string" && sellfoxSyncResources.includes(value as SellfoxSyncResource);
}

export function isSellfoxDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function nextSellfoxPage(rowsOnPage: number, pageNo: number, totalPages: number | null, pageSize = 100, maxPages = 10_000) {
  if (rowsOnPage < pageSize || pageNo >= maxPages || (totalPages !== null && pageNo >= totalPages)) return null;
  return pageNo + 1;
}
