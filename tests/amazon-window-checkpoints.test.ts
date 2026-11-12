import assert from "node:assert/strict";
import test from "node:test";
import { completeWindow, summarizeWindowCheckpoints, transportedWindow } from "../src/lib/amazon-sync/window-checkpoints";
import { readWindowCheckpointMetadata } from "../src/lib/amazon-sync/coverage";

type Run = Parameters<typeof transportedWindow>[0];
function run(id: string, from: string, to: string, changes: Partial<Run> = {}): Run {
  return { id, resource: "orders", status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true,
    frozenScope: { orderWindow: { from, to } }, summary: { coverage: { complete: true } },
    finishedAt: new Date("2026-11-09T00:00:00Z"), ...changes };
}
const target = { from: Date.parse("2026-10-10"), to: Date.parse("2026-11-09") };

test("disjoint successful windows persist the actual historical hole", () => {
  const evidence = summarizeWindowCheckpoints([
    run("newer", "2026-10-30T00:00:00Z", "2026-11-09T00:00:00Z"),
    run("older", "2026-10-10T00:00:00Z", "2026-10-20T00:00:00Z"),
  ], target, false);
  assert.equal(evidence.history.complete, false);
  assert.deepEqual(evidence.history.gaps, [{ from: "2026-10-20T00:00:00.000Z", toExclusive: "2026-10-30T00:00:00.000Z" }]);
  assert.equal(evidence.lastCompleteWindow?.taskId, "newer");
});

test("a later completed backfill cannot move the most advanced window backwards", () => {
  const evidence = summarizeWindowCheckpoints([
    run("backfill", "2026-10-10T00:00:00Z", "2026-10-20T00:00:00Z"),
    run("daily", "2026-10-20T00:00:00Z", "2026-11-09T00:00:00Z"),
  ], target, false);
  assert.equal(evidence.lastCompleteWindow?.taskId, "daily");
  assert.equal(evidence.history.complete, true);
});

test("partial transport retains the previous complete window and historical gap", () => {
  const partial = run("partial", "2026-10-20T00:00:00Z", "2026-11-09T00:00:00Z", { status: "PARTIAL_SUCCESS", summary: { coverage: { complete: false } } });
  const evidence = summarizeWindowCheckpoints([partial, run("old", "2026-10-10T00:00:00Z", "2026-10-20T00:00:00Z")], target, false);
  assert.equal(evidence.lastTransportWindow?.taskId, "partial");
  assert.equal(evidence.lastCompleteWindow?.taskId, "old");
  assert.equal(evidence.history.complete, false);
});

test("archive-only and FBA returns remain transport evidence without full-universe history", () => {
  for (const item of [run("archive", "2026-10-10", "2026-11-08", { stage: "ARCHIVED_SITE_PENDING" }),
    run("returns", "2026-10-10", "2026-11-08", { resource: "returns", summary: { coverage: { complete: true, returnsUniverseComplete: false } } })]) {
    assert.equal(transportedWindow(item)?.to, target.to);
    assert.equal(completeWindow(item), null);
  }
});

test("quarantined or legacy unknown finance attribution cannot advance a complete checkpoint", () => {
  for (const quarantinedCount of [undefined, 1]) {
    const item = run("finance", "2026-10-10", "2026-11-08", { resource: "finance", summary: { coverage: { transportComplete: true, ...(quarantinedCount === undefined ? {} : { quarantinedCount }) } } });
    assert.ok(transportedWindow(item));
    assert.equal(completeWindow(item), null);
  }
  assert.ok(completeWindow(run("finance", "2026-10-10", "2026-11-08", { resource: "finance", summary: { coverage: { transportComplete: true, quarantinedCount: 0, financialFinal: false } } })));
});

test("truncated history never claims a maximum or complete historical coverage", () => {
  const evidence = summarizeWindowCheckpoints([run("whole", "2026-10-10", "2026-11-08")], target, true);
  assert.equal(evidence.lastCompleteWindow, null);
  assert.equal(evidence.lastTransportWindow, null);
  assert.equal(evidence.history.complete, false);
  assert.equal(evidence.history.percent, null);
});

test("revision changes invalidate persisted watermarks and readers exclude arbitrary metadata", () => {
  const stored = { ...summarizeWindowCheckpoints([run("whole", "2026-10-10", "2026-11-08")], target, false), sourceRevision: 2, authorizationId: "auth", authorizationRevision: 3, rawText: "must not leak", checkpointCiphertext: "must not leak" };
  const current = readWindowCheckpointMetadata(stored, 2, "auth", 3);
  assert.equal(current?.history.complete, true);
  assert.equal(JSON.stringify(current).includes("must not leak"), false);
  for (const [revision, auth, authRevision] of [[4, "auth", 3], [2, "other", 3], [2, "auth", 4]] as const) {
    const stale = readWindowCheckpointMetadata(stored, revision, auth, authRevision);
    assert.equal(stale?.current, false);
    assert.equal(stale?.lastCompleteWindow, null);
    assert.equal(stale?.history.complete, false);
  }
});
