import assert from "node:assert/strict";
import test from "node:test";
import { defaultSyncIntervals, nextScheduledAt, parseSchedulePatch } from "@/lib/operations/schedule-policy";
import { withAmazonSyncLock, type LockClient } from "@/lib/operations/sync-lock";

test("only inventory and catalog schedules can be enabled, with bounded intervals", () => {
  assert.deepEqual(parseSchedulePatch({ resource: "inventory", enabled: true }), { resource: "inventory", enabled: true, intervalMinutes: 60 });
  for (const resource of ["orders", "ads", "finance", "fulfillment"]) {
    assert.throws(() => parseSchedulePatch({ resource, enabled: true }));
    assert.equal(parseSchedulePatch({ resource, enabled: false }).enabled, false);
  }
  for (const intervalMinutes of [0, 14, 10081, 15.5, "60", NaN]) {
    assert.throws(() => parseSchedulePatch({ resource: "inventory", enabled: true, intervalMinutes }));
  }
  assert.throws(() => parseSchedulePatch({ resource: "inventory", enabled: "true" }));
  assert.equal(parseSchedulePatch({ resource: "catalog", enabled: true }).intervalMinutes, 1440);
  assert.equal(defaultSyncIntervals.ads, 120);
  assert.equal(defaultSyncIntervals.orders, 15);
});

test("schedule waits one full interval, advances from last enqueue, and stops when disabled", () => {
  const schedule = { enabled: true, intervalMinutes: 60, lastEnqueuedAt: null as Date | null, updatedAt: new Date("2026-10-23T00:00:00Z") };
  assert.equal(nextScheduledAt(schedule)?.toISOString(), "2026-10-23T01:00:00.000Z");
  schedule.lastEnqueuedAt = new Date("2026-10-23T02:05:00Z");
  assert.equal(nextScheduledAt(schedule)?.toISOString(), "2026-10-23T03:05:00.000Z");
  assert.equal(nextScheduledAt({ ...schedule, enabled: false }), null);
});

test("manual/scheduled work shares scope lock, different workspaces stay independent, failure releases lock", async () => {
  const locks = new Set<string>();
  const client = (): LockClient => {
    let key: string | undefined;
    return {
      async connect() {},
      async query(_sql, values) {
        if (locks.has(values[0])) return { rows: [{ locked: false }] };
        key = values[0]; locks.add(key); return { rows: [{ locked: true }] };
      },
      async end() { if (key) locks.delete(key); },
    };
  };
  const scope = { organizationId: "org", workspaceId: "one", resource: "inventory" };
  let unblock!: () => void;
  const barrier = new Promise<void>((resolve) => { unblock = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const manual = withAmazonSyncLock(scope, async () => { entered(); await barrier; return "manual"; }, client);
  await started;
  assert.equal(await withAmazonSyncLock(scope, async () => assert.fail("double run"), client), null);
  assert.equal(await withAmazonSyncLock({ ...scope, workspaceId: "two" }, async () => "isolated", client), "isolated");
  unblock(); await manual;
  await assert.rejects(withAmazonSyncLock(scope, async () => { throw new Error("HTTP failure"); }, client));
  assert.equal(await withAmazonSyncLock(scope, async () => "retry", client), "retry");
  assert.equal(locks.size, 0);
});
