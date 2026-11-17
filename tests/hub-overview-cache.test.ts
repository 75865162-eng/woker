import assert from "node:assert/strict";
import test from "node:test";
import {
  getHubDatasetStats,
  invalidateHubOverview,
  clearHubOverviewCache,
  hubOverviewCacheKey,
} from "@/lib/sellfox/hub-overview-cache";

test("hub overview cache reuses fresh stats within TTL", async () => {
  clearHubOverviewCache();
  const key = hubOverviewCacheKey("org", "ws");
  let calls = 0;
  const compute = async () => { calls += 1; return [{ key: "orders", rows: 10, latest: "2026-11-18", storesWithData: 2, readError: null }]; };
  const first = await getHubDatasetStats(key, compute);
  const second = await getHubDatasetStats(key, compute);
  assert.equal(calls, 1, "second read must hit cache");
  assert.equal(second[0]?.rows, 10);
  assert.deepEqual(first, second);
});

test("invalidate forces recompute for the scope", async () => {
  clearHubOverviewCache();
  const key = hubOverviewCacheKey("org2", "ws2");
  let calls = 0;
  const compute = async () => { calls += 1; return [{ key: "orders", rows: calls, latest: null, storesWithData: 1, readError: null }]; };
  await getHubDatasetStats(key, compute);
  await getHubDatasetStats(key, compute);
  assert.equal(calls, 1);
  invalidateHubOverview("org2", "ws2");
  const after = await getHubDatasetStats(key, compute);
  assert.equal(calls, 2);
  assert.equal(after[0]?.rows, 2);
});

test("errored dataset entries are not cached", async () => {
  clearHubOverviewCache();
  const key = hubOverviewCacheKey("org3", "ws3");
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return [
      { key: "ok", rows: 5, latest: null, storesWithData: 1, readError: null },
      { key: "broken", rows: 0, latest: null, storesWithData: 0, readError: "该表统计读取失败" },
    ];
  };
  const first = await getHubDatasetStats(key, compute);
  assert.equal(first.find((s) => s.key === "broken")?.readError, "该表统计读取失败");
  const second = await getHubDatasetStats(key, compute);
  assert.equal(calls, 2, "errored entry must force recompute next time");
  assert.equal(second.find((s) => s.key === "broken")?.readError, "该表统计读取失败");
});

test("scope keys are isolated by org and workspace", async () => {
  clearHubOverviewCache();
  let calls = 0;
  const compute = async () => { calls += 1; return [{ key: "orders", rows: 1, latest: null, storesWithData: 1, readError: null }]; };
  await getHubDatasetStats(hubOverviewCacheKey("a", "ws"), compute);
  await getHubDatasetStats(hubOverviewCacheKey("b", "ws"), compute);
  assert.equal(calls, 2, "different orgs must not share cache");
});
