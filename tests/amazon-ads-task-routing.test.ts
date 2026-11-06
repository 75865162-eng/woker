import assert from "node:assert/strict";
import test from "node:test";
import { isAdsStructureTask } from "@/lib/amazon-ads/task-routing";

const task = { trigger: "schedule", stage: "DISCOVER", requestedFrom: null, requestedTo: null, _count: { reportRequests: 0, reportVersions: 0 } };
test("legacy and current structure tasks retain routing while report evidence fails closed", () => {
  for (const trigger of ["schedule", "scheduled-structure", "manual-structure", "manual-retry"]) {
    assert.equal(isAdsStructureTask({ ...task, trigger }), true);
  }
  for (const trigger of ["isolated-report", "scheduled-report", "unknown", ""]) assert.equal(isAdsStructureTask({ ...task, trigger }), false);
  for (const stage of ["REPORTS_ISOLATED", "COMPLETED_ISOLATED_REPORT", "NEW_STAGE"]) assert.equal(isAdsStructureTask({ ...task, stage }), false);
  assert.equal(isAdsStructureTask({ ...task, requestedFrom: new Date() }), false);
  assert.equal(isAdsStructureTask({ ...task, requestedTo: new Date() }), false);
  assert.equal(isAdsStructureTask({ ...task, _count: { reportRequests: 1, reportVersions: 0 } }), false);
  assert.equal(isAdsStructureTask({ ...task, _count: { reportRequests: 0, reportVersions: 1 } }), false);
  // Historical checkpoint index 5 is handled by the existing explicit adapter gate.
  assert.equal(isAdsStructureTask({ ...task, stage: "reports" }), true);
  assert.equal(isAdsStructureTask({ ...task, stage: "product-ads" }), true);
});
