/** Read DTO only. One ASIN can link many SKUs without multiplying report facts. */
export type BrandProductLink = {
  asin: string; skus: string[]; title: string | null; brand: string | null;
  thumbnailUrl: string | null; catalogRunId: string | null;
  capturedAt: string | null; detailRunIds: string[];
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() && value.length <= 20000 ? value : null;

export function brandProductMetadata(value: unknown, marketplaceId: string) {
  const facts = object(value);
  const summary = list(facts.summaries).map(object).find(row => row.marketplaceId === marketplaceId);
  const attribute = (key: string) => text(list(object(facts.attributes)[key]).map(object).find(row => row.marketplace_id === marketplaceId)?.value);
  return { title: text(summary?.itemName) ?? attribute("item_name"), brand: text(summary?.brandName) ?? attribute("brand") };
}
