import test from "node:test";
import assert from "node:assert/strict";
import { oldestBrandTurn, type BrandFairCandidate } from "@/lib/amazon-sync/brand-fairness";
import { reserveOrderToken, type OrderBucket } from "@/lib/amazon-sync/orders-rate-limit";

function simulate(fair: boolean, count = 2) {
  const peers: BrandFairCandidate[] = Array.from({ length: count }, (_, i) => ({ id: String(i), startedAt: new Date(i), nextAttemptAt: new Date(0), lastRequestAt: null }));
  let bucket: OrderBucket = { tokens: 0, replenishedAt: new Date(25_000), blockedUntil: null, observedLimit: null };
  const grants = peers.map(() => 0), times: number[] = [];
  for (let cycle = 1; cycle <= 30; cycle++) for (let i = 0; i < count; i++) {
    const now = new Date(cycle * 120_000 + i * 25_000), peer = peers[i];
    if (fair && oldestBrandTurn(peers, now)?.id !== peer.id) continue;
    const r = reserveOrderToken(bucket, { requestsPerSecond: .01, burst: 1 }, now);
    bucket = { ...bucket, tokens: r.tokens, replenishedAt: r.replenishedAt };
    peer.nextAttemptAt = r.nextAt;
    if (r.allowed) { grants[i]++; times.push(now.getTime()); peer.lastRequestAt = now; }
  }
  return { grants, times };
}
test("brand fairness breaks reproduced fixed-phase starvation without increasing quota", () => {
  assert.deepEqual(simulate(false).grants, [0, 30]);
  for (const count of [2, 4]) {
    const result = simulate(true, count);
    assert.ok(result.grants.every(n => n >= 5), JSON.stringify(result.grants));
    assert.ok(result.times.every((time, i) => i === 0 || time - result.times[i - 1] >= 100_000));
  }
});
test("brand ranking retains a deferred turn only inside bounded lookahead and resolves ties", () => {
  const now = new Date(500_000);
  const candidate = (id: string, next: number): BrandFairCandidate => ({ id, startedAt: new Date(0), lastRequestAt: null, nextAttemptAt: new Date(next) });
  assert.equal(oldestBrandTurn([candidate("b", 0), candidate("a", 620_000)], now)?.id, "a");
  assert.equal(oldestBrandTurn([candidate("b", 0), candidate("a", 620_001)], now)?.id, "b");
  assert.equal(oldestBrandTurn([], now), undefined);
});
