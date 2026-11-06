import type { CatalogItem } from "@/lib/amazon/catalog";
import { readTsv } from "./domain-reports";
import { SyncInputError } from "./policy";

export const allListingsReportType = "GET_MERCHANT_LISTINGS_ALL_DATA";
const listingAttributeColumns = {
  listingId: "listing-id",
  productId: "product-id",
  productIdType: "product-id-type",
  itemName: "item-name",
  itemCondition: "item-condition",
  price: "price",
  quantity: "quantity",
  openDate: "open-date",
  merchantShippingGroup: "merchant-shipping-group",
  itemIsMarketplace: "item-is-marketplace",
} as const;
const maxAttributeLengths: Record<keyof typeof listingAttributeColumns, number> = {
  listingId: 200, productId: 100, productIdType: 20, itemName: 2000, itemCondition: 50,
  price: 100, quantity: 20, openDate: 100, merchantShippingGroup: 200, itemIsMarketplace: 20,
};
/** Current all-listings snapshot. Never present it as 730 days of listing history.
 * Quoted TSV/BOM handled by the shared bounded reader; conflicting SKUs reject
 * the whole new snapshot, retaining the last successful publication.
 */
export function parseAllListingsReport(text: string): CatalogItem[] {
  const iterator = readTsv(text), first = iterator.next();
  if (first.done) throw new SyncInputError("Listing 报告缺少表头。", 422);
  const headers = first.value.map(h => h.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || !["seller-sku", "asin1"].every(h => headers.includes(h))) throw new SyncInputError("Listing 报告表头不符合全量报告契约。", 422);
  const rows = new Map<string, CatalogItem>();
  let count = 0;
  for (const cells of iterator) {
    if (cells.length === 1 && !cells[0]) continue;
    if (++count > 50000 || cells.length !== headers.length) throw new SyncInputError("Listing 报告超容量或行结构不完整。", 422);
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    const sellerSku = row["seller-sku"], asin = row.asin1.trim();
    if (!sellerSku.trim() || sellerSku.length > 500 || /[\x00-\x1f\x7f]/.test(sellerSku) || (asin && !/^[A-Z0-9]{10}$/.test(asin))) throw new SyncInputError("Listing 报告业务键无效。", 422);
    const listingAttributes = Object.fromEntries(Object.entries(listingAttributeColumns).map(([key, column]) => {
      const value = headers.includes(column) ? row[column] : "";
      if (value.length > maxAttributeLengths[key as keyof typeof listingAttributeColumns] || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new SyncInputError("Listing 报告属性字段无效。", 422);
      return [key, value.trim() || null];
    }));
    const item: CatalogItem = { sellerSku, asin, listingStatus: row.status?.trim() || null, fulfillmentType: row["fulfillment-channel"]?.trim() || null, listingAttributes };
    const previous = rows.get(sellerSku);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new SyncInputError("Listing 报告同一 SKU 出现冲突，未发布快照。", 422);
    rows.set(sellerSku, item);
  }
  return [...rows.values()];
}
