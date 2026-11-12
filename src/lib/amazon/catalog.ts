export type CatalogItem = { sellerSku: string; asin: string; listingStatus: string | null; fulfillmentType: string | null; listingAttributes?: Record<string, string | null> };

export const listingSummaryParserVersion = "catalog.listings-summary.v1";
/** Source text only, from the selected marketplace summary. No generic
 * attributes, notes, prices or other marketplaces are copied into L1. */
function listingSummaryAttributes(summary: Record<string, unknown> | undefined) {
  const attributes: Record<string, string | null> = {};
  for (const [key, limit] of [["itemName", 2000], ["productType", 200], ["conditionType", 100]] as const) {
    const value = summary?.[key];
    if (value === undefined) continue;
    if (value === null) { attributes[key] = null; continue; }
    if (typeof value !== "string" || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error("Amazon 刊登摘要属性无效；未发布新快照。");
    attributes[key] = value.trim() || null;
  }
  return Object.keys(attributes).length ? attributes : undefined;
}

export function extractCatalogPage(payload: unknown, marketplaceId: string): { items: CatalogItem[]; nextToken?: string } {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) throw new Error("Amazon 刊登响应缺少 items；不能当作空快照成功。");
  const value = payload as { items: unknown[]; pagination?: { nextToken?: unknown } };
  const items = value.items.map((raw): CatalogItem => {
    if (!raw || typeof raw !== "object") throw new Error("Amazon 刊登行格式无效。");
    const row = raw as { sku?: unknown; summaries?: { marketplaceId?: string; asin?: string; status?: unknown; itemName?: unknown; productType?: unknown; conditionType?: unknown }[]; fulfillmentAvailability?: { fulfillmentChannelCode?: string }[] };
    if (typeof row.sku !== "string" || !row.sku.trim()) throw new Error("Amazon 刊登缺少 Seller SKU。");
    const summary = row.summaries?.find((item) => item.marketplaceId === marketplaceId);
    const listingAttributes = listingSummaryAttributes(summary);
    const statuses = Array.isArray(summary?.status) ? summary.status.filter((item): item is string => typeof item === "string") : [];
    return { sellerSku: row.sku, asin: summary?.asin ?? "", listingStatus: statuses.length ? statuses.join(",") : null,
      fulfillmentType: row.fulfillmentAvailability?.map((item) => item.fulfillmentChannelCode).filter(Boolean).join(",") || null,
      ...(listingAttributes ? { listingAttributes } : {}) };
  });
  return { items, nextToken: typeof value.pagination?.nextToken === "string" ? value.pagination.nextToken : undefined };
}
