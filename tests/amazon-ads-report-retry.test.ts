import assert from "node:assert/strict";
import { test } from "node:test";
import { reportReadRetryAt } from "../src/lib/amazon-ads/report-retry";

const now = Date.parse("2026-11-06T00:00:00Z");
test("report read backoff grows with persisted consumed calls and is capped", () => {
  assert.deepEqual([1, 2, 3, 7, 10].map(call => reportReadRetryAt(call, null, now) - now), [1000, 2000, 4000, 60000, 60000]);
});
test("Retry-After seconds and HTTP date are minimum waits, never shortened to backoff cap", () => {
  assert.equal(reportReadRetryAt(1, "120", now), now + 120000);
  assert.equal(reportReadRetryAt(1, "Fri, 06 Nov 2026 00:02:00 GMT", now), now + 120000);
  assert.equal(reportReadRetryAt(3, "0", now), now + 4000);
  assert.equal(reportReadRetryAt(3, "Thu, 05 Nov 2026 00:00:00 GMT", now), now + 4000);
});
test("malformed Retry-After uses backoff; unrepresentable waits fail closed", () => {
  for (const value of ["-1", "1.5", "tomorrow", "2026-11-07", ""]) assert.equal(reportReadRetryAt(2, value, now), now + 2000);
  assert.equal(reportReadRetryAt(1, "999999999999999999999", now), Infinity);
});
