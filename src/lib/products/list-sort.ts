export const productListSortFields = ["sku", "chineseName", "createdAt", "purchasePrice", "status", "supplierName"] as const;

export type ProductListSortField = typeof productListSortFields[number];
export type ProductListSortDirection = "asc" | "desc";
export type ProductListSort = { field: ProductListSortField; direction: ProductListSortDirection };

export const defaultProductListSort: ProductListSort = { field: "createdAt", direction: "desc" };

export function normalizeProductListSort(field: string | null, direction: string | null): ProductListSort {
  return {
    field: productListSortFields.includes(field as ProductListSortField) ? field as ProductListSortField : defaultProductListSort.field,
    direction: direction === "asc" || direction === "desc" ? direction : defaultProductListSort.direction,
  };
}
