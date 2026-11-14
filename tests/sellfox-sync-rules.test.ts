import assert from "node:assert/strict";
import test from "node:test";
import { sellfoxSyncResources } from "../src/lib/sellfox/sync-contract";
import {
  builtinSyncRules, builtinSyncRuleMap, sellfoxScheduleIntervals, syncFirstRunOrder as registryFirstRunOrder,
  sellfoxDateChunks, sellfoxSpanDays, splitSellfoxDateChunk, isSellfoxChunkTooWide,
  sellfoxEndpointResource, sellfoxEndpointCode, endpointSyncRule, syncRuleChunkDays,
} from "../src/lib/sellfox/sync-rules";
import { syncCadenceGroups, syncResourceCadence } from "../src/lib/sellfox/sync-plan";
import { nextSellfoxScheduleAt } from "../src/lib/sellfox/schedule-time";

test("注册表覆盖全部内置资源且不重复", () => {
  assert.equal(builtinSyncRules.length, sellfoxSyncResources.length);
  assert.equal(new Set(builtinSyncRules.map((rule) => rule.id)).size, builtinSyncRules.length);
  for (const resource of sellfoxSyncResources) {
    assert.equal(builtinSyncRuleMap[resource].id, resource);
    assert.ok(builtinSyncRuleMap[resource].dependsOn.every((dep) => dep === "stores"));
  }
  assert.equal(Object.keys(sellfoxScheduleIntervals).length, sellfoxSyncResources.length - 1);
  assert.equal("hourly" in sellfoxScheduleIntervals, false);
  assert.equal(Object.keys(syncResourceCadence).length, sellfoxSyncResources.length);
  assert.equal(syncCadenceGroups().reduce((sum, group) => sum + group.resources.length, 0), sellfoxSyncResources.length);
});

test("分块上限写进规则：广告高量报表更短，冷启动顺序仍按依赖", () => {
  assert.equal(syncRuleChunkDays("ads_report"), 14);
  assert.equal(syncRuleChunkDays("ads_targeting"), 7);
  assert.equal(syncRuleChunkDays("sales"), 90);
  assert.equal(syncRuleChunkDays("inventory"), 0);
  assert.equal(registryFirstRunOrder[0].resource, "stores");
  for (let i = 1; i < registryFirstRunOrder.length; i += 1) assert.ok(registryFirstRunOrder[i].order >= registryFirstRunOrder[i - 1].order);
});

test("日期分块互不重叠、完整覆盖、每块不超过 90 天", () => {
  const chunks = sellfoxDateChunks("2026-08-17", "2026-11-14", 14);
  assert.equal(chunks[0].startDate, "2026-08-17");
  assert.equal(chunks[chunks.length - 1].endDate, "2026-11-14");
  for (let i = 0; i < chunks.length; i += 1) {
    assert.ok(sellfoxSpanDays(chunks[i].startDate, chunks[i].endDate) <= 14);
    if (i > 0) {
      const gap = sellfoxSpanDays(chunks[i - 1].endDate, chunks[i].startDate);
      assert.equal(gap, 2, "相邻块必须首尾相接不重叠");
    }
  }
  assert.deepEqual(sellfoxDateChunks("2026-11-14", "2026-11-14", 7), [{ startDate: "2026-11-14", endDate: "2026-11-14" }]);
  assert.throws(() => sellfoxDateChunks("2026-11-14", "2026-08-17", 7));
  assert.throws(() => sellfoxDateChunks("2026-08-17", "2026-11-14", 0));
  assert.throws(() => sellfoxDateChunks("2026-08-17", "2026-11-14", 91));
});

test("超限失败可自动对半拆，1 天块不再拆", () => {
  assert.ok(isSellfoxChunkTooWide(new Error("sp:广告报告超过五万行，请缩小范围。")));
  assert.ok(isSellfoxChunkTooWide(new Error("广告报告下载超过 25MB。")));
  assert.ok(!isSellfoxChunkTooWide(new Error("赛狐接口调用失败（HTTP 200 / 500）。")));
  const halves = splitSellfoxDateChunk("2026-08-17", "2026-08-30");
  assert.ok(halves);
  assert.equal(halves[0].startDate, "2026-08-17");
  assert.equal(halves[1].endDate, "2026-08-30");
  assert.equal(sellfoxSpanDays(halves[0].endDate, halves[1].startDate), 2);
  assert.equal(splitSellfoxDateChunk("2026-08-17", "2026-08-17"), null);
});

test("后台配置的端点生成同构规则，资源名经过白名单校验", () => {
  const resource = sellfoxEndpointResource("fx_rate");
  assert.equal(sellfoxEndpointCode(resource), "fx_rate");
  assert.equal(sellfoxEndpointCode("endpoint:INVALID!"), null);
  assert.equal(sellfoxEndpointCode("sales"), null);
  const rule = endpointSyncRule({ code: "fx_rate", label: "汇率", dateMode: "range", chunkDays: 30, intervalMinutes: 1440, maxRows: 50_000 });
  assert.equal(rule.id, resource);
  assert.equal(rule.chunkDays, 30);
  assert.equal(rule.builtin, false);
  assert.equal(rule.dependsOn[0], "stores");
  assert.equal(endpointSyncRule({ code: "x", label: "x", dateMode: "none", chunkDays: 30, intervalMinutes: 60, maxRows: null }).chunkDays, 0);
});

test("调度时隙仍由注册表派生，06:30 日跑资源不受改动影响", () => {
  const now = new Date("2026-11-14T20:00:00Z"); // 上海 11-15 04:00，尚未到 06:30 时隙
  const daily = nextSellfoxScheduleAt({ resource: "sales", intervalMinutes: 1440, lastEnqueuedAt: null }, now);
  assert.equal(daily.toISOString(), "2026-11-14T22:30:00.000Z"); // 上海 06:30 = 22:30Z
  const stores = nextSellfoxScheduleAt({ resource: "stores", intervalMinutes: 480, lastEnqueuedAt: null }, now);
  assert.equal(stores.getTime(), now.getTime());
});
