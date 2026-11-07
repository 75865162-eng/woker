import assert from "node:assert/strict";
import { test } from "node:test";
import { readReportAcquisitionState } from "../src/lib/amazon-ads/report-checkpoint";

const checkpoint = () => ({ version: 1, phase: "CREATE", calls: { create: 0, poll: 0, download: 0 }, evidenceFileIds: [] });

test("report checkpoint accepts phase progression and exact exhausted budgets without resetting them", () => {
  for (const phase of ["CREATE", "POLL", "DOWNLOAD", "STAGE", "PUBLISH", "COMPLETE"]) {
    const value = { ...checkpoint(), phase, calls: { create: 1, poll: 10, download: 3 } };
    assert.equal(readReportAcquisitionState(value), value);
  }
});

test("report checkpoint rejects missing, coerced, fractional and overflow budgets", () => {
  for (const operation of ["create", "poll", "download"] as const) {
    for (const count of [undefined, null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, { create: 2, poll: 11, download: 4 }[operation]]) {
      const value = checkpoint();
      Object.assign(value.calls, { [operation]: count });
      assert.throws(() => readReportAcquisitionState(value), /ADS_REPORT_CHECKPOINT_INVALID/);
    }
  }
});

test("report checkpoint preserves valid reservations and rejects ambiguous operation ownership", () => {
  const valid = { ...checkpoint(), calls: { create: 1, poll: 0, download: 0 }, reserved: { operation: "create", fence: 1, owner: "fixture-worker" } };
  assert.equal(readReportAcquisitionState(valid), valid);
  for (const reserved of [null, [], {}, { ...valid.reserved, operation: "poll" }, { ...valid.reserved, operation: "constructor" }, { ...valid.reserved, fence: -1 }, { ...valid.reserved, fence: "1" }, { ...valid.reserved, owner: "" }]) {
    assert.throws(() => readReportAcquisitionState({ ...valid, reserved }), /CHECKPOINT_INVALID/);
  }
  assert.throws(() => readReportAcquisitionState({ ...valid, calls: checkpoint().calls }), /CHECKPOINT_INVALID/);
});

test("report checkpoint rejects malformed phase, poll time, evidence and row bounds without mutation", () => {
  for (const patch of [{ version: 2 }, { phase: "UNKNOWN" }, { nextPollAt: "never" }, { evidenceFileIds: null }, { evidenceFileIds: ["a", "a"] }, { evidenceFileIds: Array.from({ length: 12 }, (_, i) => String(i)) }, { expectedRows: 0 }, { expectedRows: 1001 }]) {
    const value = { ...checkpoint(), ...patch };
    const before = structuredClone(value);
    assert.throws(() => readReportAcquisitionState(value), /CHECKPOINT_INVALID/);
    assert.deepEqual(value, before);
  }
  for (const value of [undefined, null, [], "checkpoint"]) assert.throws(() => readReportAcquisitionState(value), /CHECKPOINT_INVALID/);
});
