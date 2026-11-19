import test from "node:test";
import assert from "node:assert/strict";
import { restockSnapshotId } from "../src/lib/sellfox/restock-materialize";
import { filterRestockRows } from "../src/lib/sellfox/restock-read";
import type { SellfoxBrowseQuery } from "../src/lib/sellfox/browse-query";

const baseQuery = {
  page: 1, pageSize: 20, search: "", searchType: "", exactMatch: false, status: "", dimension: "asin",
} as unknown as SellfoxBrowseQuery;

const rows = [
  { id: "s1|asin1", storeId: "s1", asin: "B001", msku: "M1", sku: "S1", title: "Widget", parentAsin: "P1", suggest: 10 },
  { id: "s1|asin2", storeId: "s1", asin: "B002", msku: "M2", sku: "S2", title: "Gadget", parentAsin: "P1", suggest: 0 },
  { id: "s2|asin1", storeId: "s2", asin: "B001", msku: "M1", sku: "S1", title: "Widget", parentAsin: "P1", suggest: 5 },
];

test("restockSnapshotId is deterministic and encodes the full scope", () => {
  const id = restockSnapshotId("org1", "ws1", "asin", "2026-11-20");
  assert.equal(id, "restocksnap|org1|ws1|asin|2026-11-20");
  assert.equal(id, restockSnapshotId("org1", "ws1", "asin", "2026-11-20"));
  assert.notEqual(id, restockSnapshotId("org1", "ws1", "msku", "2026-11-20"));
});

test("filterRestockRows applies store scope without mutating input", () => {
  const out = filterRestockRows(rows, baseQuery, ["s2"]);
  assert.deepEqual(out.map((r) => r.id), ["s2|asin1"]);
  assert.equal(rows.length, 3);
});

test("filterRestockRows status needs/covered matches the live semantics", () => {
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, status: "needs" }, undefined).map((r) => r.id), ["s1|asin1", "s2|asin1"]);
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, status: "covered" }, undefined).map((r) => r.id), ["s1|asin2"]);
});

test("filterRestockRows search honors exact and substring modes across identity fields", () => {
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, search: "B002" }, undefined).map((r) => r.id), ["s1|asin2"]);
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, search: "widget", exactMatch: true }, undefined).map((r) => r.id), ["s1|asin1", "s2|asin1"]);
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, search: "wid", exactMatch: true }, undefined).map((r) => r.id), []);
  assert.deepEqual(filterRestockRows(rows, { ...baseQuery, search: "widget" }, undefined).map((r) => r.id), ["s1|asin1", "s2|asin1"]);
});

test("filterRestockRows keeps all rows when no scope or filter is given", () => {
  assert.equal(filterRestockRows(rows, baseQuery, undefined).length, 3);
});
