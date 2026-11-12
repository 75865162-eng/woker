import assert from "node:assert/strict";
import test from "node:test";
import { financeQueryRange } from "../src/lib/amazon-sync/finance-query-range";
import { datasetForTable, normalizeDatasetQuery } from "../src/lib/amazon-sync/mcp-datasets";

test("Finance precise UTC range preserves milliseconds and excludes the upper endpoint", () => {
  const range = financeQueryRange(new URLSearchParams({ fromTimestamp: "2025-07-04T09:31:07.189Z", toTimestamp: "2025-08-03T09:31:07Z" }));
  assert.equal(range.gte?.toISOString(), "2025-07-04T09:31:07.189Z");
  assert.equal(range.lt?.toISOString(), "2025-08-03T09:31:07.000Z");
  assert.equal(financeQueryRange(new URLSearchParams({ to: "2025-08-03" })).lt?.toISOString(), "2025-08-04T00:00:00.000Z");
  for (const value of ["2026-02-30T00:00:00Z", "2026-11-01T24:00:00Z", "2026-11-01", "2026-11-01T00:00:00+01:00", "", "2026-11-01T00:00:00.0001Z"]) assert.throws(() => financeQueryRange(new URLSearchParams({ fromTimestamp: value })));
  for (const patch of [{ from: "2025-08-01" }, { to: "2025-08-01" }, { toTimestamp: "2025-07-04T09:31:07.189Z" }] as Array<Record<string, string>>) assert.throws(() => financeQueryRange(new URLSearchParams({ fromTimestamp: "2025-07-04T09:31:07.189Z", ...patch })));
});

test("MCP Finance advertises precise bounds and rejects conflicts before querying", () => {
  const dataset = datasetForTable("finance_transactions");
  const filters = { fromTimestamp: "2025-07-04T09:31:07.189Z", toTimestamp: "2025-08-03T09:31:07.189Z" };
  assert.equal(dataset.filters.fromTimestamp.format, "date-time");
  assert.equal(normalizeDatasetQuery(dataset, { filters }).filters.toTimestamp, filters.toTimestamp);
  for (const patch of [{ from: "2025-07-04" }, { toTimestamp: "2025-07-01T00:00:00Z" }, { toTimestamp: "2027-08-03T00:00:00Z" }, { fromTimestamp: "invalid" }]) assert.throws(() => normalizeDatasetQuery(dataset, { filters: { ...filters, ...patch } }));
});
