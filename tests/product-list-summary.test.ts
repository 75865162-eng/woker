import assert from "node:assert/strict";
import test from "node:test";
import { createProductListSummaryContribution } from "@/lib/products/product-list-summary";

test("operations progress card counts incomplete progress instead of the listing-confirming status", () => {
  assert.equal(
    createProductListSummaryContribution({
      status: "listing_confirming",
      operationsProgressIncomplete: false,
    }).operationsProgress,
    0,
  );
  assert.equal(
    createProductListSummaryContribution({
      status: "developing",
      operationsProgressIncomplete: true,
    }).operationsProgress,
    1,
  );
});

test("summary overdue excludes terminal products and uses workflow due time", () => {
  const now = new Date("2026-09-14T00:00:00.000Z");

  assert.equal(
    createProductListSummaryContribution({
      status: "ops_review",
      workflowDueAt: "2026-09-13T23:59:59.000Z",
    }, now).overdue,
    1,
  );
  assert.equal(
    createProductListSummaryContribution({
      status: "listed",
      workflowDueAt: "2026-09-13T23:59:59.000Z",
    }, now).overdue,
    0,
  );
});
