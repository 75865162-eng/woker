import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { claimSellfoxRun, fenceSellfoxRun, finishSellfoxRun, recoverExpiredSellfoxRuns, sellfoxLeaseMs, sellfoxMaxRunAttempts } from "@/lib/sellfox/run-lease";
import { recoverSellfoxQueueRun } from "@/lib/sellfox/queue-recovery";
import { runStore } from "./helpers/sellfox-run-store";

function fixture() {
  let row: Record<string, unknown> = { id: "run", status: "queued", executionAttempts: 0, summary: { progress: { pageNo: 3 }, reportDate: "2026-10-24" } };
  const db = { sellfoxSyncRun: runStore(() => row, (next) => { row = next; }) } as unknown as Pick<Prisma.TransactionClient, "sellfoxSyncRun">;
  return { db, get: () => row, set: (next: Record<string, unknown>) => { row = { ...row, ...next }; } };
}

test("only one owner can claim; expiry enables takeover and rejects all stale commits", async () => {
  const { db, get } = fixture(); const start = new Date();
  const first = await claimSellfoxRun("run", db, start); assert.ok(first);
  assert.equal(await claimSellfoxRun("run", db, start), null);
  const later = new Date(start.getTime() + sellfoxLeaseMs + 1);
  const second = await claimSellfoxRun("run", db, later); assert.ok(second);
  assert.notEqual(first.token, second.token);
  await assert.rejects(fenceSellfoxRun(first, db, later), /租约已失效/);
  await assert.rejects(finishSellfoxRun(first, { status: "done" }, db), /租约已失效/);
  assert.equal(get().executionToken, second.token); assert.equal(get().status, "running");
  assert.deepEqual(get().summary, { progress: { pageNo: 3 }, reportDate: "2026-10-24" });
});

test("renewal prevents early recovery; expired recovery preserves committed checkpoints", async () => {
  const { db, get } = fixture(); const start = new Date();
  const lease = await claimSellfoxRun("run", db, start); assert.ok(lease);
  await fenceSellfoxRun(lease, db, new Date(start.getTime() + 60_000));
  assert.equal((await recoverExpiredSellfoxRuns(db, new Date(start.getTime() + 120_001))).count, 0);
  assert.equal((await recoverExpiredSellfoxRuns(db, new Date(start.getTime() + 180_001))).count, 1);
  assert.equal(get().status, "queued"); assert.equal(get().executionToken, null);
  assert.deepEqual(get().summary, { progress: { pageNo: 3 }, reportDate: "2026-10-24" });
});

test("database attempt limit survives Redis loss and completed runs cannot restart", async () => {
  const { db, get, set } = fixture();
  for (let attempt = 0; attempt < sellfoxMaxRunAttempts; attempt++) {
    const lease = await claimSellfoxRun("run", db); assert.ok(lease);
    set({ status: "queued", executionToken: null, leaseExpiresAt: null });
  }
  assert.equal(await claimSellfoxRun("run", db), null);
  assert.equal(get().status, "failed"); assert.match(String(get().error), /重试上限/);
  set({ status: "done", executionAttempts: 0 });
  assert.equal(await claimSellfoxRun("run", db), null); assert.equal(get().status, "done");
});

test("queue recovery recreates missing jobs, retries retained failures and leaves BullMQ-owned jobs alone", async () => {
  for (const state of ["missing", "failed", "completed", "active", "delayed", "waiting"]) {
    const operations: string[] = [];
    const queue = { getJob: async (id: string) => {
      assert.equal(id, "sellfox-run");
      return state === "missing" ? undefined : { getState: async () => state, retry: async () => { operations.push("retry"); }, remove: async () => { operations.push("remove"); } };
    } };
    await recoverSellfoxQueueRun("run", queue, async () => { operations.push("enqueue"); });
    assert.deepEqual(operations, state === "missing" ? ["enqueue"] : state === "failed" ? ["retry"] : state === "completed" ? ["remove", "enqueue"] : []);
  }
});
