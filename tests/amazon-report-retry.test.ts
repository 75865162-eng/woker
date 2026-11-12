import assert from "node:assert/strict";
import test from "node:test";
import { completedReportIdentity, preservesReportCheckpoint } from "../src/lib/amazon-sync/report-retry";

test("report retries preserve identity without confusing catalog API pagination", () => {
  assert.equal(preservesReportCheckpoint("sales_traffic", {}), true);
  assert.equal(preservesReportCheckpoint("catalog", { amazonSellerId: "" }), true);
  assert.equal(preservesReportCheckpoint("catalog", { amazonSellerId: "seller-fixture" }), false);
  assert.equal(preservesReportCheckpoint("catalog", {}), false);
  assert.equal(preservesReportCheckpoint("inventory", { amazonSellerId: "" }), false);
});

test("old partial report summaries restore only a bounded saved report identity", () => {
  assert.deepEqual(completedReportIdentity({ coverage: { reportId: "fixture-report", documentId: "fixture-document", missingDates: ["2026-11-01"] } }), { reportId: "fixture-report", documentId: "fixture-document" });
  for (const summary of [null, [], { coverage: null }, { coverage: { reportId: "fixture" } }, { coverage: { reportId: " fixture", documentId: "d" } }, { coverage: { reportId: "fixture", documentId: "x".repeat(201) } }]) {
    assert.equal(completedReportIdentity(summary), null);
  }
});
