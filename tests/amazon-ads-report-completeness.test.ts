import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCompleteness, reportMetricFields } from "../src/lib/amazon-ads/report-completeness";

test("report completeness distinguishes saved field counts from business zero and absent facts", () => {
  const counts = { impressions: BigInt(3), clicks: BigInt(2), orders: BigInt(0), units: BigInt(3), spend: BigInt(1), sales: BigInt(0) };
  const result = reportCompleteness(BigInt(3), counts);
  assert.equal(result.basis, "CURRENT_OBSERVED_FACTS");
  assert.equal(result.observedFactCount, "3");
  assert.deepEqual(result.metrics.impressions, { providedFactCount: "3", missingFactCount: "0", status: "COMPLETE" });
  assert.deepEqual(result.metrics.clicks, { providedFactCount: "2", missingFactCount: "1", status: "PARTIAL" });
  assert.deepEqual(result.metrics.sales, { providedFactCount: "0", missingFactCount: "3", status: "MISSING" });
  const empty = reportCompleteness(BigInt(0), Object.fromEntries(reportMetricFields.map(field => [field, BigInt(0)])) as typeof counts);
  assert.ok(Object.values(empty.metrics).every(metric => metric.status === "NO_FACTS"));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("completeness serializes exact large counts and refuses impossible evidence", () => {
  const observed = BigInt("900719925474099312345");
  const counts = Object.fromEntries(reportMetricFields.map(field => [field, observed - BigInt(1)])) as Record<typeof reportMetricFields[number], bigint>;
  const result = reportCompleteness(observed, counts);
  assert.equal(result.metrics.spend.providedFactCount, "900719925474099312344");
  assert.equal(result.metrics.spend.missingFactCount, "1");
  assert.throws(() => reportCompleteness(BigInt(-1), counts), /COMPLETENESS_INVALID/);
  assert.throws(() => reportCompleteness(observed, { ...counts, spend: observed + BigInt(1) }), /COMPLETENESS_INVALID/);
  assert.throws(() => reportCompleteness(observed, { ...counts, spend: BigInt(-1) }), /COMPLETENESS_INVALID/);
});
