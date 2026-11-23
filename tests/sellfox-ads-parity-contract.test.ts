import assert from "node:assert/strict";
import test from "node:test";
import { hostPage, hostDataset } from "../src/lib/sellfox/host-pages";
import { normalizeAdsEntityState, ADS_ENTITY_STATES } from "../src/lib/sellfox/host-read";
import {
  adsWriteCapability, buildAdsBidPlan, decideAdsExecution, adsWriteIdempotencyKey,
  type WritableProposal,
} from "../src/lib/sellfox/ads-write";

const ads = hostPage("ads");

test("冻结合同：广告页一级标签覆盖十个管理标签并保留小时/ABA 入口", () => {
  assert.ok(ads, "必须存在广告承接页");
  const groups = ads!.groups ?? [];
  const ids = new Set(groups.map((group) => group.id));
  for (const id of ["portfolio", "campaign", "adgroup", "adproduct", "targeting", "searchterm", "negative", "placement", "amc", "log"]) {
    assert.ok(ids.has(id), `缺少管理标签分组 ${id}`);
  }
  assert.ok(ids.has("hourly"), "必须保留小时曲线入口");
  assert.ok(ids.has("aba"), "必须保留 ABA 搜索词入口");
  // 所有分组引用的 dataset id 必须真实存在，不能把规划写成 live。
  for (const group of groups) {
    for (const datasetId of group.datasetIds) {
      assert.ok(hostDataset(datasetId), `分组 ${group.id} 引用了不存在的 dataset ${datasetId}`);
    }
  }
});

test("冻结合同：AMC 阻断且无读取路径；否定投放空集合数据集仍为 live", () => {
  const groups = ads!.groups ?? [];
  const amc = groups.find((group) => group.id === "amc")!;
  assert.equal(amc.status, "blocked");
  assert.equal(amc.datasetIds.length, 0, "AMC 无来源，不能挂数据集");
  const negative = groups.find((group) => group.id === "negative")!;
  assert.ok(negative.datasetIds.includes("ads_ent_sb_ne_target"));
  assert.ok(negative.datasetIds.includes("ads_ent_sd_ne_target"));
  // 两个空集合端点在数据集目录里仍是 live（读取返回空行，不伪造）。
  assert.equal(hostDataset("ads_ent_sb_ne_target")?.dataset.status, "live");
  assert.equal(hostDataset("ads_ent_sd_ne_target")?.dataset.status, "live");
});

test("冻结合同：实体数据集声明 stateFilter，日报不声明", () => {
  assert.equal(hostDataset("ads_ent_sp_campaign")?.dataset.stateFilter, true);
  assert.equal(hostDataset("ads_ent_sp_target")?.dataset.stateFilter, true);
  assert.equal(hostDataset("ads_campaign")?.dataset.stateFilter, undefined);
  assert.equal(hostDataset("ads_targeting")?.dataset.stateFilter, undefined);
});

test("实体 state 白名单只接受实见取值", () => {
  assert.deepEqual([...ADS_ENTITY_STATES], ["enabled", "paused", "archived"]);
  assert.equal(normalizeAdsEntityState("enabled"), "enabled");
  assert.equal(normalizeAdsEntityState("PAUSED"), "");
  assert.equal(normalizeAdsEntityState("x'; drop table--"), "");
  assert.equal(normalizeAdsEntityState(undefined), "");
});

test("写闸门：未开开关/transport 未实现时一律不执行、逐条失败", () => {
  const capability = adsWriteCapability({});
  assert.equal(capability.enabled, false);
  assert.equal(capability.transport, "unimplemented");
  const proposals: WritableProposal[] = [{
    id: "p1", action: "LOWER_BID", entityType: "SP:keyword", externalId: "123456",
    status: "APPROVED", current: { bid: 1.0 }, proposed: { bidMultiplier: 0.7 },
  }];
  const plan = buildAdsBidPlan(proposals);
  assert.equal(plan.updates.length, 1);
  const result = decideAdsExecution({ capability, plan, idempotencyKey: "k" });
  assert.equal(result.applied, 0);
  assert.ok(result.items.every((item) => item.status === "FAILED" && item.code === "NOT_ENABLED"));
});

test("写计划：缺 current.bid / text hash ID / 非 bid 动作一律跳过，不猜值", () => {
  const proposals: WritableProposal[] = [
    { id: "no-bid", action: "LOWER_BID", entityType: "SP:keyword", externalId: "111", status: "APPROVED", current: null, proposed: { bidMultiplier: 0.7 } },
    { id: "text-id", action: "RAISE_BID", entityType: "SP:target", externalId: "text:abc", status: "APPROVED", current: { bid: 0.5 }, proposed: { bidMultiplier: 1.1 } },
    { id: "pause", action: "PAUSE", entityType: "SP:keyword", externalId: "222", status: "APPROVED", current: { bid: 1 }, proposed: { state: "PAUSED" } },
    { id: "pending", action: "LOWER_BID", entityType: "SP:keyword", externalId: "333", status: "PENDING", current: { bid: 1 }, proposed: { bidMultiplier: 0.7 } },
    { id: "sb", action: "LOWER_BID", entityType: "SB:keyword", externalId: "444", status: "APPROVED", current: { bid: 1 }, proposed: { bidMultiplier: 0.7 } },
    { id: "ok", action: "LOWER_BID", entityType: "SP:keyword", externalId: "555", status: "APPROVED", current: { bid: 1 }, proposed: { bidMultiplier: 0.7 } },
  ];
  const plan = buildAdsBidPlan(proposals);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].entityId, "555");
  assert.equal(plan.updates[0].bid, 0.7);
  assert.equal(plan.items.filter((item) => item.status === "SKIPPED").length, 5);
});

test("写闸门：开关打开但 transport 未实现仍 NOT_IMPLEMENTED，applied 恒为 0", () => {
  const capability = adsWriteCapability({ AMAZON_ADS_WRITE_ENABLED: "1" });
  assert.equal(capability.enabled, true);
  assert.equal(capability.transport, "unimplemented");
  const proposal: WritableProposal = { id: "p", action: "RAISE_BID", entityType: "SP:target", externalId: "999", status: "APPROVED", current: { bid: 0.8 }, proposed: { bidMultiplier: 1.2 } };
  const result = decideAdsExecution({ capability, plan: buildAdsBidPlan([proposal]), idempotencyKey: "k" });
  assert.equal(result.applied, 0);
  assert.equal(result.items[0].code, "NOT_IMPLEMENTED");
});

test("写幂等键：相同输入稳定，不同提议/倍率不同", () => {
  const base = { organizationId: "org", workspaceId: "ws", proposalId: "p1", action: "execute", proposed: { bidMultiplier: 0.7 } };
  assert.equal(adsWriteIdempotencyKey(base), adsWriteIdempotencyKey({ ...base }));
  assert.notEqual(adsWriteIdempotencyKey(base), adsWriteIdempotencyKey({ ...base, proposalId: "p2" }));
  assert.notEqual(adsWriteIdempotencyKey(base), adsWriteIdempotencyKey({ ...base, proposed: { bidMultiplier: 0.8 } }));
});
