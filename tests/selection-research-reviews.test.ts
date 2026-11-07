import test from "node:test";
import assert from "node:assert/strict";
import { containsReviewBody, prepareLowStarReviews, rankReviewProblems, type ReviewEvidence } from "@/lib/selection-research/review-evidence";

const row: ReviewEvidence = { evidenceId: "isolated-call", asin: "B000000001", reviewId: "r1", stars: 2,
  date: "2026-01-01", variant: "test", body: "Isolated review text", scope: "current_child", relevant: true, applicable: true };

test("review filtering retains original text and child/parent scope while excluding unusable samples", () => {
  const data = prepareLowStarReviews([row, { ...row, reviewId: "r2", body: " ISOLATED   REVIEW TEXT " },
    { ...row, reviewId: "r3", body: "" }, { ...row, reviewId: "r4", stars: 4 },
    { ...row, reviewId: "r5", relevant: false }, { ...row, reviewId: "r6", applicable: false },
    { ...row, reviewId: "r7", body: "Historical text", scope: "parent_history" }]);
  assert.equal(data.retained.length, 2);
  assert.equal(data.retained[0].body, row.body);
  assert.deepEqual(data.counts, { currentChild: 1, parentHistory: 1, unknownScope: 0 });
  assert.deepEqual(data.excluded.map(entry => entry.reason), ["DUPLICATE", "EMPTY_BODY", "NOT_LOW_STAR", "UNRELATED_PRODUCT", "NOT_APPLICABLE"]);
  assert.match(data.limitations.join(" "), /置信度低/);
});

test("improvements require retained review evidence and count unique references only", () => {
  const data = prepareLowStarReviews([row]);
  const problem = { category: "test category", suggestion: "test improvement", reviewKeys: ["review-1", "review-1"], severity: 5, improvementValue: 4 };
  const ranked = rankReviewProblems(data, [problem]);
  assert.equal(ranked[0].count, 1);
  assert.deepEqual(ranked[0].evidenceIds, [row.evidenceId]);
  assert.throws(() => rankReviewProblems(data, [{ ...problem, reviewKeys: ["invented"] }]), /EVIDENCE_MISSING/);
});


test("review provenance decodes MCP JSON text and requires original complete body", () => {
  const body = 'First line\nThe \"quoted\" review';
  const raw = { content: [{ type: "text", text: JSON.stringify({ reviews: [{ body }] }) }] };
  assert.equal(containsReviewBody(raw, body), true);
  assert.equal(containsReviewBody(raw, "invented review"), false);
  assert.equal(containsReviewBody(raw, "First line"), false);
});
