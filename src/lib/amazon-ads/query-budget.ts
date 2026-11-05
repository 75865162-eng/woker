import { SyncInputError } from "@/lib/amazon-sync/policy";

/** Per-process safety budget; it does not replace a shared deployment-wide rate limiter. */
export function createAdsQueryBudget(limit = 60, windowMs = 60000, maxKeys = 10000) {
  const windows = new Map<string, { until: number; count: number }>();
  return (credentialId: string, now = Date.now()) => {
    for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
    const prior = windows.get(credentialId);
    if ((!prior && windows.size >= maxKeys) || (prior && prior.count >= limit)) throw new SyncInputError("Ads 查询频率超限，请稍后重试。", 429);
    windows.set(credentialId, { until: prior?.until ?? now + windowMs, count: (prior?.count ?? 0)+1 });
  };
}
export const assertAdsQueryBudget = createAdsQueryBudget();
