import test from "node:test";
import assert from "node:assert/strict";
import { isSellfoxDate, isSellfoxSyncResource, nextSellfoxPage } from "@/lib/sellfox/sync-contract";

test("Sellfox sync resource contract accepts the stable domains only", () => {
  for (const resource of ["stores", "inventory", "sales", "performance", "hourly", "listings", "ads_report"]) {
    assert.equal(isSellfoxSyncResource(resource), true);
  }
  assert.equal(isSellfoxSyncResource("products"), false);
  assert.equal(isSellfoxSyncResource(null), false);
});

test("Sellfox dates reject normalized invalid calendar days", () => {
  assert.equal(isSellfoxDate("2024-02-29"), true);
  assert.equal(isSellfoxDate("2026-02-29"), false);
  assert.equal(isSellfoxDate("2026-10-24"), true);
  assert.equal(isSellfoxDate("2026-1-04"), false);
});

test("page checkpoints stop at short pages, reported end, or the hard page bound", () => {
  assert.equal(nextSellfoxPage(100, 1, 4), 2);
  assert.equal(nextSellfoxPage(100, 4, 4), null);
  assert.equal(nextSellfoxPage(99, 1, null), null);
  assert.equal(nextSellfoxPage(100, 10_000, null), null);
});
