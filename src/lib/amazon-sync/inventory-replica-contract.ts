import type { Prisma } from "@prisma/client";
import { amazonBusinessData } from "./business-data";
import { digest } from "./approval-policy";
import { SyncInputError } from "./policy";

export const inventoryReplicaLimit = 500;
export const inventoryReplicaSelect = {
  sellerSku: true, asin: true, fnSku: true, condition: true, fulfillableQuantity: true,
  inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true,
  reservedQuantity: true, unfulfillableQuantity: true, researchingQuantity: true,
  sourceUpdatedAt: true, dataVersion: true, capturedAt: true, createdAt: true,
} as const;
export type InventoryReplicaRow = {
  sellerSku: string; asin: string; fnSku: string; condition: string;
  fulfillableQuantity: number; inboundWorkingQuantity: number; inboundShippedQuantity: number;
  inboundReceivingQuantity: number; reservedQuantity: number; unfulfillableQuantity: number;
  researchingQuantity: number; dataVersion: number; sourceUpdatedAt: string | null; capturedAt: string; createdAt: string;
};
export type InventoryReplica = {
  version: 1; sourceId: string; sellerAccountId: string; marketplaceId: string; amazonSellerId: string;
  cloudRunId: string; publishedAt: string; rows: InventoryReplicaRow[]; digest: string;
};
export const catalogReplicaSelect = {
  sellerSku: true, asin: true, listingStatus: true, fulfillmentType: true,
  listingAttributes: true, fieldSources: true, sourceUpdatedAt: true,
  dataVersion: true, capturedAt: true, createdAt: true,
} as const;
export type CatalogReplicaRow = {
  sellerSku: string; asin: string; listingStatus: string | null; fulfillmentType: string | null;
  listingAttributes: Prisma.JsonValue; fieldSources: Prisma.JsonValue;
  sourceUpdatedAt: string | null; dataVersion: number; capturedAt: string; createdAt: string;
};
export type CatalogReplica = Omit<InventoryReplica, "rows"> & { resource: "catalog"; rows: CatalogReplicaRow[] };
export type SnapshotReplica = InventoryReplica | CatalogReplica;
const invalid = (): never => { throw new SyncInputError("快照副本格式、版本或完整性无效，未发布本地版本。", 409); };
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function validateEnvelope(input: unknown, resource: "inventory" | "catalog"): SnapshotReplica {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const value = input as SnapshotReplica;
  const keys = ["version", "sourceId", "sellerAccountId", "marketplaceId", "amazonSellerId", "cloudRunId", "publishedAt", "rows", "digest", ...(resource === "catalog" ? ["resource"] : [])];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || value.version !== 1 || resource === "catalog" && (!("resource" in value) || value.resource !== "catalog")) return invalid();
  for (const key of ["sourceId", "sellerAccountId", "marketplaceId", "amazonSellerId", "cloudRunId"] as const) if (typeof value[key] !== "string" || !value[key] || value[key].length > 200) return invalid();
  if (!date(value.publishedAt) || !Array.isArray(value.rows) || value.rows.length > inventoryReplicaLimit) return invalid();
  const { digest: checksum, ...body } = value;
  if (typeof checksum !== "string" || digest(body) !== checksum || Buffer.byteLength(JSON.stringify(value)) > 450 * 1024) return invalid();
  return value;
}
export function parseInventoryReplica(input: unknown): InventoryReplica {
  const value = validateEnvelope(input, "inventory") as InventoryReplica;
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!row || typeof row !== "object" || Object.keys(row).length !== Object.keys(inventoryReplicaSelect).length || Object.keys(row).some(key => !Object.hasOwn(inventoryReplicaSelect, key))) return invalid();
    for (const key of ["sellerSku", "asin", "fnSku", "condition"] as const) if (typeof row[key] !== "string" || row[key].length > 10000) return invalid();
    if (!row.sellerSku || !date(row.capturedAt) || !date(row.createdAt) || row.sourceUpdatedAt !== null && !date(row.sourceUpdatedAt)) return invalid();
    for (const key of ["fulfillableQuantity", "inboundWorkingQuantity", "inboundShippedQuantity", "inboundReceivingQuantity", "reservedQuantity", "unfulfillableQuantity", "researchingQuantity", "dataVersion"] as const) if (!Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > 2147483647) return invalid();
    const businessKey = JSON.stringify([row.sellerSku, row.condition]);
    if (seen.has(businessKey)) return invalid();
    seen.add(businessKey);
  }
  return value;
}

export function parseCatalogReplica(input: unknown): CatalogReplica {
  const value = validateEnvelope(input, "catalog") as CatalogReplica;
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!row || typeof row !== "object" || Object.keys(row).length !== Object.keys(catalogReplicaSelect).length || Object.keys(row).some(key => !Object.hasOwn(catalogReplicaSelect, key))) return invalid();
    for (const key of ["sellerSku", "asin"] as const) if (typeof row[key] !== "string" || row[key].length > 10000) return invalid();
    for (const key of ["listingStatus", "fulfillmentType"] as const) if (row[key] !== null && (typeof row[key] !== "string" || row[key].length > 10000)) return invalid();
    if (!row.sellerSku || !date(row.capturedAt) || !date(row.createdAt) || row.sourceUpdatedAt !== null && !date(row.sourceUpdatedAt) || !Number.isSafeInteger(row.dataVersion) || row.dataVersion < 0 || row.dataVersion > 2147483647 || seen.has(row.sellerSku)) return invalid();
    for (const key of ["listingAttributes", "fieldSources"] as const) {
      try {
        if (row[key] === undefined || digest(amazonBusinessData(row[key])) !== digest(row[key])) return invalid();
      } catch { return invalid(); }
    }
    seen.add(row.sellerSku);
  }
  return value;
}
export function parseSnapshotReplica(input: unknown, resource: "inventory" | "catalog"): SnapshotReplica {
  return resource === "catalog" ? parseCatalogReplica(input) : parseInventoryReplica(input);
}
