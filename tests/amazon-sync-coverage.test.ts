import assert from "node:assert/strict";
import test from "node:test";
import { successfulWindow } from "../src/lib/amazon-sync/coverage";

test("FBA received-return report success does not count as complete return-universe history", () => {
  const run = {
    resource: "returns",
    stage: "COMPLETED",
    paginationComplete: true,
    frozenScope: { returnWindow: { from: "2026-10-01T00:00:00Z", to: "2026-10-31T23:59:59Z" } },
    summary: { coverage: { complete: true, returnsUniverseComplete: false } },
  };
  assert.equal(successfulWindow(run), null);
});

test("complete bounded source windows remain eligible for history coverage", () => {
  const run = {
    resource: "orders",
    stage: "COMPLETED",
    paginationComplete: true,
    frozenScope: { orderWindow: { from: "2026-10-01T00:00:00Z", to: "2026-10-31T23:59:59Z" } },
    summary: { coverage: { complete: true } },
  };
  assert.deepEqual(successfulWindow(run), { from: Date.parse("2026-10-01T00:00:00Z"), to: Date.parse("2026-10-31T23:59:59Z") });
});

test("published inventory event and reimbursement reports persist complete quality evidence", () => {
  for (const resource of ["inventory_events", "reimbursements"]) {
    const run = {
      resource,
      stage: "COMPLETED",
      paginationComplete: true,
      frozenScope: { reportWindow: { from: "2026-10-01", to: "2026-10-30", ...(resource === "inventory_events" ? { eventType: "" } : {}) } },
      summary: { coverage: { complete: true, transportComplete: true, attributionComplete: true } },
    };
    assert.deepEqual(successfulWindow(run), { from: Date.parse("2026-10-01"), to: Date.parse("2026-10-31") });
  }
});

test("filtered ledger events never count as complete all-event history", () => {
  for (const eventType of ["Adjustments", "Receipts", undefined]) {
    assert.equal(successfulWindow({ resource: "inventory_events", stage: "COMPLETED", paginationComplete: true,
      frozenScope: { reportWindow: { from: "2026-10-01", to: "2026-10-30", eventType } },
      summary: { coverage: { complete: true, transportComplete: true, attributionComplete: true } } }), null);
  }
});
