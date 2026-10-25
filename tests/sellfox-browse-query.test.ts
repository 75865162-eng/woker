import test from "node:test";
import assert from "node:assert/strict";
import { sellfoxBrowseQuery, sellfoxSnapshotWhere, sellfoxRunWhere, sellfoxHourlyWhere } from "@/lib/sellfox/browse-query";
import { readSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";
import { sellfoxPayloadPreview } from "@/lib/sellfox/payload-preview";

const query = (params: string) => sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));
test("browse query validates real dates and integer pagination without truncating historical ranges", () => {
  for (const params of ["from=2026-02-29", "from=2026-10-25&to=2026-10-24", "page=1.5", "page=Infinity", "pageSize=201"]) assert.throws(() => query(params));
  assert.equal(query("from=2020-01-01&to=2026-10-24").from, "2020-01-01");
  assert.deepEqual(query("shopExternalId=a&shopExternalId=a&shopExternalId=b").shopExternalIds, ["a", "b"]);
});
test("snapshots and hourly filters preserve tenant, site, date and supported search", () => {
  const q = query("from=2026-10-01&to=2026-10-24&site=US&search=SKU");
  const where = sellfoxSnapshotWhere(q, "org", "workspace", ["store"]);
  assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace");
  assert.deepEqual(where.reportDate, { gte: "2026-10-01", lte: "2026-10-24" });
  assert.deepEqual(where.SellfoxStore, { marketplace: "US" });
  assert.deepEqual(where.storeId, { in: ["store"] });
  assert.match(JSON.stringify(sellfoxHourlyWhere(q, "org", "workspace")), /entityName/);
  assert.equal(sellfoxSnapshotWhere(query("allDates=1"), "org", "workspace", undefined, true).reportDate, undefined);
});
test("run date ranges use inclusive Shanghai calendar dates with an exclusive next-day boundary", () => {
  const where = sellfoxRunWhere(query("from=2026-10-24&to=2026-10-24&search=failed"), "org", "workspace");
  assert.deepEqual(where.startedAt, { gte: new Date("2026-10-23T16:00:00Z"), lt: new Date("2026-10-24T16:00:00Z") });
  assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace");
  assert.match(JSON.stringify(where.OR), /status/);
});
test("shareable view parameters round-trip shops, site, history and pagination", () => {
  const view = readSellfoxView(new URLSearchParams("domain=sales&from=2026-10-01&to=2026-10-24&site=US&search=MSKU&shopExternalId=a&shopExternalId=b&page=2&allDates=1"));
  assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
  const runs = sellfoxViewParams({ ...view, domain: "runs" }, true);
  assert.equal(runs.has("shopExternalId"), false); assert.equal(runs.has("site"), false);
});
test("store, developer and sales-only SPU dimensions round trip while unknown values retain safe defaults", () => {
  for (const domain of ["sales", "performance"]) {
    for (const dimension of ["store", "developer", ...(domain === "sales" ? ["spu"] : [])]) {
      const view = readSellfoxView(new URLSearchParams(`domain=${domain}&dimension=${dimension}`));
      assert.equal(view.dimension, dimension);
      assert.deepEqual(readSellfoxView(sellfoxViewParams(view)), view);
      assert.equal(query(sellfoxViewParams(view, true).toString()).dimension, dimension);
    }
  }
  for (const dimension of ["", "payload", "storeId", 'store";DROP TABLE', "salesperson"]) {
    const params = new URLSearchParams({ dimension });
    assert.equal(readSellfoxView(params).dimension, "asin");
    assert.equal(query(params.toString()).dimension, "msku");
  }
});
test("raw details redact nested credentials and bound large or deep payloads", () => {
  const preview = sellfoxPayloadPreview({ token: "private", rows: [{ client_secret: "hidden", link: "https://example.test/?access_token=private&sign=private", msku: "sku-a" }], large: "x".repeat(3000) });
  const output = JSON.stringify(preview.payload);
  assert.doesNotMatch(output, /private|hidden/); assert.match(output, /sku-a/); assert.equal(preview.truncated, true);
  assert.equal(sellfoxPayloadPreview(Array.from({ length: 1000 }, () => ({ a: "x" }))).truncated, true);
});


test("legacy profit queries explicitly isolate all-orders and settled partitions", () => {
  assert.equal(sellfoxSnapshotWhere(query(""), "org", "ws", undefined, true).onlySettle, false);
  assert.equal(sellfoxSnapshotWhere(query("onlySettle=1"), "org", "ws", undefined, true).onlySettle, true);
  assert.equal(sellfoxSnapshotWhere(query("onlySettle=1"), "org", "ws").onlySettle, undefined);
});
