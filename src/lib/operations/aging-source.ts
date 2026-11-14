import type { PrismaClient } from "@prisma/client";

/**
 * WMS aging facts for a seller SKU.
 *
 * WMS aging snapshots are keyed by ProductRecord, while replenishment policies are
 * keyed by Amazon seller SKU. The bridge is ProductListing (sku -> productRecordId).
 * Nothing here fabricates an age: a missing or stale snapshot yields `agingDays: null`,
 * which keeps the clearance branch closed instead of assuming stock is fresh.
 */

export type SkuAgingFact = {
  /** Conservative lower bound of the oldest occupied band (e.g. 90 when only 90-180 is non-empty). */
  agingDays: number | null;
  /** Quantity-weighted midpoint of the bands, for display only. */
  weightedAgeDays: number | null;
  snapshotId: string | null;
  snapshotDate: string | null;
  capturedAt: string | null;
  dataStatus: "COMPLETE" | "NEEDS_DATA" | "ABSENT";
  warehouses: number;
  note: string;
};

type BandKey = "days0To30" | "days30To60" | "days60To90" | "days90To180" | "days180To365" | "days365Plus";

const BANDS: Array<{ key: BandKey; lower: number; mid: number }> = [
  { key: "days365Plus", lower: 365, mid: 400 },
  { key: "days180To365", lower: 180, mid: 270 },
  { key: "days90To180", lower: 90, mid: 135 },
  { key: "days60To90", lower: 60, mid: 75 },
  { key: "days30To60", lower: 30, mid: 45 },
  { key: "days0To30", lower: 0, mid: 15 },
];

const readUnits = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
};

/** Oldest occupied band (lower bound) plus quantity-weighted midpoint age. */
export function agingFromEstimate(estimate: unknown): { agingDays: number | null; weightedAgeDays: number | null } {
  if (!estimate || typeof estimate !== "object" || Array.isArray(estimate)) {
    return { agingDays: null, weightedAgeDays: null };
  }
  const record = estimate as Record<string, unknown>;
  let total = 0;
  let weighted = 0;
  let agingDays: number | null = null;
  for (const band of BANDS) {
    const units = readUnits(record[band.key]);
    if (units === null) return { agingDays: null, weightedAgeDays: null };
    total += units;
    weighted += units * band.mid;
    if (agingDays === null && units > 0) agingDays = band.lower;
  }
  if (total <= 0) return { agingDays: null, weightedAgeDays: null };
  return { agingDays: agingDays ?? 0, weightedAgeDays: Math.round((weighted / total) * 100) / 100 };
}

type SnapshotRow = {
  id: string;
  warehouseId: string;
  snapshotDate: Date;
  capturedAt: Date;
  records: unknown;
};

const absent = (note: string): SkuAgingFact => ({
  agingDays: null,
  weightedAgeDays: null,
  snapshotId: null,
  snapshotDate: null,
  capturedAt: null,
  dataStatus: "ABSENT",
  warehouses: 0,
  note,
});

/**
 * Reads aging facts for many seller SKUs in one pass.
 * Recent WMS snapshots are the only accepted source; older ones are reported as ABSENT.
 */
export async function readSkuAgingFacts(
  db: PrismaClient,
  input: {
    organizationId: string;
    workspaceId: string;
    skus: string[];
    asOf: Date;
    maxSnapshotAgeDays?: number;
  },
): Promise<Map<string, SkuAgingFact>> {
  const facts = new Map<string, SkuAgingFact>();
  const skus = [...new Set(input.skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!skus.length) return facts;

  const maxAge = input.maxSnapshotAgeDays ?? 14;
  const cutoff = new Date(input.asOf.getTime() - maxAge * 86_400_000);
  cutoff.setUTCHours(0, 0, 0, 0);

  const listings = await db.productListing.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, sku: { in: skus } },
    select: { sku: true, productRecordId: true },
  });
  if (!listings.length) {
    for (const sku of skus) facts.set(sku, absent("商品主档无对应 ProductListing，无法关联 WMS 库龄。"));
    return facts;
  }

  const recordToSkus = new Map<string, Set<string>>();
  for (const listing of listings) {
    const bucket = recordToSkus.get(listing.productRecordId) ?? new Set<string>();
    bucket.add(listing.sku);
    recordToSkus.set(listing.productRecordId, bucket);
  }
  const wantedRecords = [...recordToSkus.keys()];

  const snapshots = (await db.wmsAgingSnapshot.findMany({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      status: "COMPLETE",
      snapshotDate: { gte: cutoff },
    },
    orderBy: [{ snapshotDate: "desc" }, { capturedAt: "desc" }],
    select: { id: true, warehouseId: true, snapshotDate: true, capturedAt: true, records: true },
    take: 200,
  })) as SnapshotRow[];

  if (!snapshots.length) {
    for (const sku of skus) facts.set(sku, absent(`近 ${maxAge} 天无 COMPLETE 状态的 WMS 库龄快照。`));
    return facts;
  }

  // Latest snapshot per warehouse, so a re-capture the same day is not double counted.
  const latestByWarehouse = new Map<string, SnapshotRow>();
  for (const snapshot of snapshots) {
    if (!latestByWarehouse.has(snapshot.warehouseId)) latestByWarehouse.set(snapshot.warehouseId, snapshot);
  }

  const wanted = new Set(wantedRecords);
  const bandsByRecord = new Map<string, { bands: Record<BandKey, number>; warehouses: Set<string>; snapshotIds: Set<string>; oldest: SnapshotRow }>();
  for (const snapshot of latestByWarehouse.values()) {
    if (!Array.isArray(snapshot.records)) continue;
    for (const raw of snapshot.records as unknown[]) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const productRecordId = typeof row.productRecordId === "string" ? row.productRecordId : "";
      if (!productRecordId || !wanted.has(productRecordId)) continue;
      if (row.dataStatus !== "COMPLETE") continue;
      const estimate = row.estimate;
      if (!estimate || typeof estimate !== "object" || Array.isArray(estimate)) continue;
      const entry = bandsByRecord.get(productRecordId) ?? {
        bands: { days0To30: 0, days30To60: 0, days60To90: 0, days90To180: 0, days180To365: 0, days365Plus: 0 },
        warehouses: new Set<string>(),
        snapshotIds: new Set<string>(),
        oldest: snapshot,
      };
      let usable = true;
      for (const band of BANDS) {
        const units = readUnits((estimate as Record<string, unknown>)[band.key]);
        if (units === null) { usable = false; break; }
        entry.bands[band.key] += units;
      }
      if (!usable) continue;
      entry.warehouses.add(snapshot.warehouseId);
      entry.snapshotIds.add(snapshot.id);
      if (snapshot.snapshotDate < entry.oldest.snapshotDate) entry.oldest = snapshot;
      bandsByRecord.set(productRecordId, entry);
    }
  }

  for (const [productRecordId, skuList] of recordToSkus) {
    const entry = bandsByRecord.get(productRecordId);
    for (const sku of skuList) {
      if (!entry || !entry.warehouses.size) {
        facts.set(sku, absent("WMS 快照存在但该商品无 COMPLETE 库龄记录（可能是批次未齐或数据待补）。"));
        continue;
      }
      const { agingDays, weightedAgeDays } = agingFromEstimate(entry.bands);
      facts.set(sku, {
        agingDays,
        weightedAgeDays,
        snapshotId: `wmsAging:${[...entry.snapshotIds].join(",")}`,
        snapshotDate: entry.oldest.snapshotDate.toISOString().slice(0, 10),
        capturedAt: entry.oldest.capturedAt.toISOString(),
        dataStatus: agingDays === null ? "NEEDS_DATA" : "COMPLETE",
        warehouses: entry.warehouses.size,
        note: agingDays === null
          ? "库龄分档合计为零：按无库龄处理，不推断。"
          : `WMS 库龄（${entry.warehouses.size} 个仓合并，快照 ${entry.oldest.snapshotDate.toISOString().slice(0, 10)}）：最老档下界 ${agingDays} 天，加权约 ${weightedAgeDays} 天。`,
      });
    }
  }
  return facts;
}
