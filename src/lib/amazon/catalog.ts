export type CatalogItem = { sellerSku: string; asin: string; listingStatus: string | null; fulfillmentType: string | null };

export function extractCatalogPage(payload: unknown, marketplaceId: string): { items: CatalogItem[]; nextToken?: string } {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) throw new Error("Amazon 刊登响应缺少 items；不能当作空快照成功。");
  const value = payload as { items: unknown[]; pagination?: { nextToken?: unknown } };
  const items = value.items.map((raw): CatalogItem => {
    if (!raw || typeof raw !== "object") throw new Error("Amazon 刊登行格式无效。");
    const row = raw as { sku?: unknown; summaries?: { marketplaceId?: string; asin?: string; status?: unknown }[]; fulfillmentAvailability?: { fulfillmentChannelCode?: string }[] };
    if (typeof row.sku !== "string" || !row.sku.trim()) throw new Error("Amazon 刊登缺少 Seller SKU。");
    const summary = row.summaries?.find((item) => item.marketplaceId === marketplaceId);
    const statuses = Array.isArray(summary?.status) ? summary.status.filter((item): item is string => typeof item === "string") : [];
    return { sellerSku: row.sku, asin: summary?.asin ?? "", listingStatus: statuses.length ? statuses.join(",") : null,
      fulfillmentType: row.fulfillmentAvailability?.map((item) => item.fulfillmentChannelCode).filter(Boolean).join(",") || null };
  });
  return { items, nextToken: typeof value.pagination?.nextToken === "string" ? value.pagination.nextToken : undefined };
}
