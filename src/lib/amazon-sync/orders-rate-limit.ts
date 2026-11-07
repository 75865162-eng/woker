import { createHash } from "node:crypto";

export type OrderBucket = { tokens: number; replenishedAt: Date; blockedUntil: Date | null; observedLimit: number | null };
export function orderBucketKey(sellerId: string, applicationId: string, operation: "searchOrders" | "getOrder" = "searchOrders") {
  return createHash("sha256").update(JSON.stringify([`${operation}.2026-01-01`, sellerId, applicationId])).digest("hex");
}
/** Pure token bucket. Callers serialize reservation with a PostgreSQL advisory lock. */
export function reserveOrderToken(bucket: OrderBucket | null, policy: { requestsPerSecond: number; burst: number }, now: Date) {
  const rate = Math.min(policy.requestsPerSecond, bucket?.observedLimit ?? policy.requestsPerSecond);
  const elapsed = bucket ? Math.max(0, now.getTime() - bucket.replenishedAt.getTime()) / 1000 : 0;
  const tokens = Math.min(policy.burst, (bucket?.tokens ?? policy.burst) + elapsed * rate);
  const wait = Math.max(0, (bucket?.blockedUntil?.getTime() ?? 0) - now.getTime(), tokens >= 1 ? 0 : Math.ceil((1 - tokens) / rate * 1000));
  return { allowed: wait === 0, nextAt: new Date(now.getTime() + wait), tokens: wait === 0 ? tokens - 1 : tokens, replenishedAt: now };
}
