/**
 * 赛狐同步水位线（只读派生，不改存储契约）。
 *
 * 以已成功完成的 SellfoxSyncRun 为事实源，派生「资源 × 店铺」粒度的最新成功水位，
 * 替代 connection 级单点 lastSyncAt，供接入核对与 readiness 展示。
 *
 * 注意：这是"最后成功"观测水位，不参与同步任务的游标推进（游标仍由 checkpoint 持久化），
 * 因此不会改变现有断点续跑语义。
 */
export type SellfoxRunLike = {
  resource: string;
  status: string;
  finishedAt: Date | null;
  summary: unknown;
};

export type SellfoxWatermarkKey = {
  resource: string;
  shopExternalId: string;
};

export type SellfoxWatermark = {
  lastSuccessAt: Date | null;
  lastReportDate: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function keyOf(key: SellfoxWatermarkKey) {
  return `${key.resource}\u0000${key.shopExternalId}`;
}

/**
 * 从 run 历史派生每个 (resource, 店铺) 的最新成功水位。
 * 只有 status 明确为 done/SUCCEEDED 且有 finishedAt 的 run 才计入。
 */
export function deriveSellfoxWatermarks(runs: SellfoxRunLike[]): Map<string, SellfoxWatermark> {
  const result = new Map<string, SellfoxWatermark>();
  for (const run of runs) {
    if (!["done", "SUCCEEDED"].includes(run.status)) continue;
    const summary = asRecord(run.summary);
    const shops = summary?.shopExternalIds;
    if (!Array.isArray(shops) || !shops.length) continue;
    const reportDate = typeof summary?.reportDate === "string" ? summary.reportDate
      : typeof summary?.endDate === "string" ? summary.endDate : null;
    const finishedAt = run.finishedAt;
    for (const rawShop of shops) {
      if (typeof rawShop !== "string" || !rawShop.trim()) continue;
      const k = keyOf({ resource: run.resource, shopExternalId: rawShop });
      const existing = result.get(k);
      if (existing && finishedAt && existing.lastSuccessAt && existing.lastSuccessAt >= finishedAt) continue;
      result.set(k, {
        lastSuccessAt: finishedAt ?? existing?.lastSuccessAt ?? null,
        lastReportDate: reportDate ?? existing?.lastReportDate ?? null,
      });
    }
  }
  return result;
}

export function lookupSellfoxWatermark(watermarks: Map<string, SellfoxWatermark>, key: SellfoxWatermarkKey): SellfoxWatermark | null {
  return watermarks.get(keyOf(key)) ?? null;
}
