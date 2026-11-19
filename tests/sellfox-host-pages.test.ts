import assert from "node:assert/strict";
import test from "node:test";
import { hostDataset, hostPages, hostSummary, sellfoxNavOrder } from "../src/lib/sellfox/host-pages";
import { replicaPages } from "../src/lib/sellfox/replica-pages";
import { sellfoxSyncResources } from "../src/lib/sellfox/sync-contract";
import { syncCadenceGroups, syncFirstRunOrder, syncResourceCadence, syncShardScopeKey } from "../src/lib/sellfox/sync-plan";

test("承接页与数据集目录结构合法", () => {
  const ids = new Set<string>();
  for (const page of hostPages) {
    assert.match(page.href, /^\/sellfox\/[a-z-]+$/);
    assert.ok(page.datasets.length > 0, `${page.id} 至少要有一个数据集`);
    for (const dataset of page.datasets) {
      assert.ok(!ids.has(dataset.id), `数据集 id 重复：${dataset.id}`);
      ids.add(dataset.id);
      assert.ok(dataset.table, `${dataset.id} 必须声明落表`);
      assert.ok(dataset.api.length > 0, `${dataset.id} 必须声明接口`);
      assert.ok(dataset.columns.length > 0, `${dataset.id} 必须声明列`);
      // live 必须有读取路径（reader / endpoint / rawCode 原始行读取），planned/blocked 一定不能有（否则页面会读到空表冒充数据）。
      if (dataset.status === "live") assert.ok(dataset.reader || dataset.endpoint || dataset.rawCode, `${dataset.id} 已接入但没有读取路径`);
      else assert.equal(dataset.reader ?? dataset.endpoint ?? dataset.rawCode, undefined, `${dataset.id} 未接入却声明了读取路径`);
    }
  }
});

test("导航顺序覆盖全部承接页与复刻页", () => {
  const hrefs = [...replicaPages.map((page) => page.href), ...hostPages.map((page) => page.href)];
  for (const href of hrefs) assert.ok(sellfoxNavOrder.includes(href as (typeof sellfoxNavOrder)[number]), `${href} 不在导航顺序里`);
  assert.equal(new Set(sellfoxNavOrder).size, sellfoxNavOrder.length, "导航顺序有重复项");
  assert.equal(hostSummary().pages, hostPages.length);
});

test("同步节奏覆盖全部同步资源，分片键按资源粒度生成", () => {
  for (const resource of sellfoxSyncResources) assert.ok(syncResourceCadence[resource], `${resource} 没有节奏归属`);
  const grouped = syncCadenceGroups().flatMap((group) => group.resources);
  assert.equal(new Set(grouped).size, sellfoxSyncResources.length);
  assert.equal(syncShardScopeKey("inventory", { storeExternalId: "A1" }), "store:A1");
  assert.equal(syncShardScopeKey("sales", { storeExternalId: "A1", period: "2026-11-13" }), "store:A1|2026-11-13");
  assert.equal(syncShardScopeKey("stores", {}), "all");
  assert.ok(syncFirstRunOrder[0].resource === "stores", "首跑必须从店铺开始");
});

test("查询数据集时能反查到所属页面", () => {
  const found = hostDataset("settlement");
  assert.equal(found?.page.id, "finance");
  assert.equal(hostDataset("not-a-dataset"), null);
});
