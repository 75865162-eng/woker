import { digest } from "./approval-policy";
import { SyncInputError } from "./policy";
export const orderReplicaLimit = 500, orderItemReplicaLimit = 1000;
export const orderReplicaItemSelect = { orderItemId: true, asin: true, sellerSku: true, quantityOrdered: true, proceedsOriginal: true, proceedsAmount: true, currencyCode: true } as const;
export const orderReplicaSelect = {
  amazonOrderId: true, createdTime: true, sourceUpdatedAt: true, rawStatus: true, normalizedStatus: true,
  marketplaceTimeZone: true, capturedAt: true, detailsUpdatedAt: true, detailPolicyDigest: true,
  fulfilledBy: true, fulfillmentServiceLevel: true, grandTotalOriginal: true, grandTotalAmount: true, currencyCode: true,
  items: { select: orderReplicaItemSelect, orderBy: { orderItemId: "asc" as const } },
  task: { select: { id: true, status: true, stage: true, resource: true, sourceId: true } },
} as const;
export type OrderReplicaItem = { orderItemId: string; asin: string | null; sellerSku: string | null; quantityOrdered: number; proceedsOriginal: string | null; proceedsAmount: string | null; currencyCode: string | null };
export type OrderReplicaRow = {
  amazonOrderId: string; createdTime: string; sourceUpdatedAt: string; rawStatus: string | null; normalizedStatus: string | null;
  marketplaceTimeZone: string; capturedAt: string; detailsUpdatedAt: string | null; detailPolicyDigest: string | null;
  fulfilledBy: string | null; fulfillmentServiceLevel: string | null; grandTotalOriginal: string | null; grandTotalAmount: string | null; currencyCode: string | null;
  items: OrderReplicaItem[]; task: { id: string; status: string; stage: string; resource: "orders"; sourceId: string };
};
export type OrderReplica = { version: 1; domain: "orders"; sourceId: string; sellerAccountId: string; amazonSellerId: string; marketplaceId: string; rows: OrderReplicaRow[]; digest: string };
const shape = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const text = (v: unknown, max = 10000) => typeof v === "string" && v.length > 0 && v.length <= max;
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const decimal = (v: unknown) => v === null || typeof v === "string" && /^-?\d{1,35}(?:\.\d{1,30})?$/.test(v);
const invalid = (): never => { throw new SyncInputError("订单副本格式、来源或完整性无效，未修改本地数据。", 409); };
export function parseOrderReplica(input: unknown): OrderReplica {
  if (!shape(input, ["version", "domain", "sourceId", "sellerAccountId", "amazonSellerId", "marketplaceId", "rows", "digest"])) return invalid();
  const value = input as OrderReplica;
  if (value.version !== 1 || value.domain !== "orders" || !Array.isArray(value.rows) || value.rows.length > orderReplicaLimit || Buffer.byteLength(JSON.stringify(value)) > 450 * 1024) return invalid();
  for (const key of ["sourceId", "sellerAccountId", "amazonSellerId", "marketplaceId"] as const) if (!text(value[key], 200)) return invalid();
  const seen = new Set<string>(), tasks = new Map<string, string>(); let items = 0;
  for (const row of value.rows) {
    if (!shape(row, Object.keys(orderReplicaSelect)) || !text(row.amazonOrderId, 200) || seen.has(row.amazonOrderId) || !date(row.createdTime) || !date(row.sourceUpdatedAt) || !date(row.capturedAt) || row.detailsUpdatedAt !== null && !date(row.detailsUpdatedAt)) return invalid();
    if (!text(row.marketplaceTimeZone, 100)) return invalid();
    try { new Intl.DateTimeFormat("en", { timeZone: row.marketplaceTimeZone }); } catch { return invalid(); }
    for (const key of ["rawStatus", "normalizedStatus", "detailPolicyDigest", "fulfilledBy", "fulfillmentServiceLevel", "grandTotalOriginal", "currencyCode"] as const) if (row[key] !== null && (typeof row[key] !== "string" || row[key].length > 10000)) return invalid();
    if (!decimal(row.grandTotalAmount) || !Array.isArray(row.items) || (items += row.items.length) > orderItemReplicaLimit) return invalid();
    const itemIds = new Set<string>();
    for (const item of row.items) {
      if (!shape(item, Object.keys(orderReplicaItemSelect)) || !text(item.orderItemId, 200) || itemIds.has(item.orderItemId) || !Number.isSafeInteger(item.quantityOrdered) || item.quantityOrdered < 0 || item.quantityOrdered > 2147483647 || !decimal(item.proceedsAmount)) return invalid();
      for (const key of ["asin", "sellerSku", "proceedsOriginal", "currencyCode"] as const) if (item[key] !== null && (typeof item[key] !== "string" || item[key].length > 10000)) return invalid();
      itemIds.add(item.orderItemId);
    }
    const task = row.task;
    if (!shape(task, ["id", "status", "stage", "resource", "sourceId"]) || !text(task.id, 200) || !text(task.status, 200) || !text(task.stage, 200) || task.resource !== "orders" || task.sourceId !== value.sourceId) return invalid();
    if (tasks.has(task.id) && tasks.get(task.id) !== digest(task)) return invalid();
    tasks.set(task.id, digest(task)); seen.add(row.amazonOrderId);
  }
  const { digest: checksum, ...body } = value;
  if (typeof checksum !== "string" || digest(body) !== checksum) return invalid();
  return value;
}
