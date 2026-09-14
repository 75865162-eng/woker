import assert from "node:assert/strict";
import test from "node:test";
import { getProductProjectionStatus } from "@/lib/products/product-detail-service";

test("product detail stays available while projection is pending", () => {
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: null,
      textRevision: null,
    }),
    "pending",
  );
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 2,
      textRevision: 3,
    }),
    "pending",
  );
});

test("product detail projection becomes ready only when all read models match source revision", () => {
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 3,
      textRevision: 3,
      listSummaryRevision: 3,
      productCenterRevision: 3,
    }),
    "ready",
  );
});

test("product detail remains pending until Product Center and list summary are current", () => {
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 3,
      textRevision: 3,
      listSummaryRevision: null,
      productCenterRevision: 3,
    }),
    "pending",
  );
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 3,
      textRevision: 3,
      listSummaryRevision: 3,
      productCenterRevision: 3,
      stateStatus: "pending",
    }),
    "pending",
  );
});

test("stale projection failure from an older revision does not mask current read models", () => {
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 3,
      textRevision: 3,
      listSummaryRevision: 3,
      productCenterRevision: 3,
      stateStatus: "failed",
      stateSourceRevision: 2,
    }),
    "ready",
  );
  assert.equal(
    getProductProjectionStatus({
      sourceRevision: 3,
      summaryRevision: 3,
      textRevision: 3,
      listSummaryRevision: 3,
      productCenterRevision: 3,
      stateStatus: "failed",
      stateSourceRevision: 3,
    }),
    "failed",
  );
});
