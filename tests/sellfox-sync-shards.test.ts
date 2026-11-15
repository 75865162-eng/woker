import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunShards, sellfoxCoverageSources } from "../src/lib/sellfox/sync-shards";
import { sellfoxSyncResources } from "../src/lib/sellfox/sync-contract";

test("sales 分片按日期 × 店铺展开，行数来自快照检查点 writes", () => {
  const shards = buildRunShards("sales", { startDate: "2026-11-13", endDate: "2026-11-14" }, { startDate: "2026-11-13", endDate: "2026-11-14", storeCount: 2, writes: 30 }, {
    snapshots: {
      "2026-11-13": { stores: { "shop-a": { productNum: { writes: 12 }, orderNum: { writes: 3 } }, "shop-b": { productNum: { writes: 10 } } } },
      "2026-11-14": { stores: { "shop-a": { productNum: { writes: 5 } } } },
    },
  });
  assert.deepEqual(shards, [
    { scopeKey: "store:shop-a", period: "2026-11-13", status: "done", rows: 15 },
    { scopeKey: "store:shop-b", period: "2026-11-13", status: "done", rows: 10 },
    { scopeKey: "store:shop-a", period: "2026-11-14", status: "done", rows: 5 },
  ]);
});

test("performance 分片取非结算检查点的 synced", () => {
  const shards = buildRunShards("performance", { startDate: "2026-11-13", endDate: "2026-11-13" }, { synced: 7 }, {
    performance: { "2026-11-13": { stores: { "shop-a": { synced: 7 } } } },
    performanceSettled: { "2026-11-13": { stores: { "shop-a": { synced: 7 } } } },
  });
  assert.equal(shards.length, 1);
  assert.equal(shards[0].rows, 7);
});

test("listing/orders 分片带断点 cursor", () => {
  const shards = buildRunShards("listings", {}, { count: 4 }, {
    listings: { "shop-a": { pageNo: 5, done: true, count: 4 } },
  });
  assert.deepEqual(shards, [{ scopeKey: "store:shop-a", period: "latest", status: "done", rows: 4, cursor: { pageNo: 5, done: true } }]);
});

test("广告分片按店铺聚合 rows，任一单元失败即 failed", () => {
  const shards = buildRunShards("ads_report", { startDate: "2026-11-13", endDate: "2026-11-14" }, {
    units: {
      "u1": { store: "shop-a", status: "done", rows: 20 },
      "u2": { store: "shop-a", status: "done", rows: 8 },
      "u3": { store: "shop-b", status: "failed", rows: 0, error: "40019" },
    },
    count: 28,
  }, null);
  assert.deepEqual(shards, [
    { scopeKey: "store:shop-a", period: "2026-11-13..2026-11-14", status: "done", rows: 28 },
    { scopeKey: "store:shop-b", period: "2026-11-13..2026-11-14", status: "failed", rows: 0 },
  ]);
});

test("结构对不上时退回单个聚合分片，不编造店铺明细", () => {
  const shards = buildRunShards("hourly", { reportDate: "2026-11-14" }, { count: 120 }, null);
  assert.deepEqual(shards, [{ scopeKey: "*", period: "2026-11-14", status: "done", rows: 120 }]);
  const stores = buildRunShards("stores", {}, { count: 39 }, null);
  assert.deepEqual(stores, [{ scopeKey: "*", period: "latest", status: "done", rows: 39 }]);
});

test("覆盖度白名单覆盖全部已接入资源（stores 除外，无事实表）", () => {
  for (const resource of sellfoxSyncResources) {
    if (resource === "stores") continue;
    assert.ok(sellfoxCoverageSources[resource], `缺 ${resource} 的覆盖度数据源`);
  }
  assert.equal(sellfoxCoverageSources.stores, undefined);
  assert.equal(sellfoxCoverageSources["not-a-resource"], undefined);
});
