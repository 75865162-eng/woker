import { canonical } from "./approval-policy";

export function assertConsistentSnapshotRows(rows: object[], resource: string) {
  const seen = new Map<string, string>();
  const fields = resource === "inventory"
    ? ["sellerSku", "condition", "asin", "fnSku", "fulfillableQuantity", "inboundWorkingQuantity", "inboundShippedQuantity", "inboundReceivingQuantity", "reservedQuantity", "unfulfillableQuantity", "researchingQuantity", "sourceUpdatedAt"]
    : ["sellerSku", "asin", "listingStatus", "fulfillmentType", "listingAttributes", "sourceUpdatedAt"];
  for (const object of rows) {
    const row = object as Record<string, unknown>;
    const key = canonical([row.sellerSku, resource === "inventory" ? row.condition : null]);
    const signature = canonical(Object.fromEntries(fields.map(field => [field, row[field] instanceof Date ? row[field].toISOString() : field === "listingAttributes" ? row[field] ?? null : row[field]])));
    if (seen.has(key) && seen.get(key) !== signature) throw new Error("重复业务键包含冲突数据；不能发布完整快照。");
    seen.set(key, signature);
  }
}
