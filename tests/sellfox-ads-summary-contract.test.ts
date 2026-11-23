import assert from "node:assert/strict";
import test from "node:test";
import { hostDataset, hostPage } from "../src/lib/sellfox/host-pages";
import { ADS_SUMMARY_SPECS, ADS_BUCKETS } from "../src/lib/sellfox/ads-summary-spec";
import { adsSummaryCsv } from "../src/lib/sellfox/ads-entity-summary";

const summaryIds = ["ads_campaign_summary", "ads_ad_group_summary", "ads_product_summary", "ads_targeting_summary"] as const;

test("统一查询：四个实体 × 区间汇总数据集已接入且粒度唯一", () => {
  const ads = hostPage("ads");
  assert.ok(ads);
  for (const id of summaryIds) {
    const entry = hostDataset(id);
    assert.ok(entry, `缺少汇总数据集 ${id}`);
    assert.equal(entry.dataset.status, "live");
    assert.ok(entry.dataset.summaryKind, `${id} 必须声明 summaryKind`);
    assert.equal(entry.dataset.dateRange, true, "汇总必须支持日期区间");
    assert.equal(entry.dataset.stateFilter, true, "汇总必须支持实体当前态筛选");
    const spec = ADS_SUMMARY_SPECS[entry.dataset.summaryKind];
    assert.ok(spec, "汇总类型必须有声明");
    assert.match(spec.grain, /一行一/);
    const keys = spec.columns.map((column) => column.key);
    for (const metric of ["impressions", "clicks", "ctr", "cost", "cpc", "adOrders", "adSales", "acos", "roas", "reportDates"]) {
      assert.ok(keys.includes(metric), `${id} 缺少汇总指标 ${metric}`);
    }
    assert.equal(new Set(keys).size, keys.length, `${id} 列不可重复`);
  }
});

test("统一查询：汇总视图是四个管理标签的首选，日报与实体当前态仍保留", () => {
  const ads = hostPage("ads");
  const groups = new Map((ads?.groups ?? []).map((group) => [group.id, group.datasetIds]));
  assert.equal(groups.get("campaign")?.[0], "ads_campaign_summary");
  assert.equal(groups.get("adgroup")?.[0], "ads_ad_group_summary");
  assert.equal(groups.get("adproduct")?.[0], "ads_product_summary");
  assert.equal(groups.get("targeting")?.[0], "ads_targeting_summary");
  assert.ok(groups.get("campaign")?.includes("ads_campaign"));
  assert.ok(groups.get("campaign")?.includes("ads_ent_sp_campaign"));
});

test("实体身份映射来自真实 payload 键，投放覆盖关键词与商品投放两种端点", () => {
  assert.equal(ADS_SUMMARY_SPECS.campaign.entityKey, "campaignId");
  assert.equal(ADS_SUMMARY_SPECS.adgroup.entityKey, "groupId");
  assert.equal(ADS_SUMMARY_SPECS.adproduct.entityKey, "adId");
  const targeting = ADS_SUMMARY_SPECS.targeting.entities.map((entity) => entity.code);
  assert.ok(targeting.includes("ads_ent_sp_target"));
  assert.ok(targeting.includes("ads_ent_sp_keyword"));
  assert.ok(targeting.includes("ads_ent_sb_target"));
  assert.ok(targeting.includes("ads_ent_sb_keyword"));
  assert.ok(targeting.includes("ads_ent_sd_target"));
});

test("聚合后筛选：表现分组是互斥的五类，未知独立成组", () => {
  assert.deepEqual([...ADS_BUCKETS], ["orders", "clicksNoOrders", "impressionsNoClicks", "noPerformance", "insufficient"]);
});

test("导出：CSV 按列输出，空值与引号/换行安全转义", () => {
  const columns = [
    { key: "name", label: "名称" },
    { key: "cost", label: "花费", kind: "money" as const },
    { key: "acos", label: "ACOS", kind: "rate" as const },
  ];
  const csv = adsSummaryCsv(columns, [
    { name: 'A,"B"\nC', cost: 12.34, acos: 0.2 },
    { name: "空值", cost: null, acos: null },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "名称,花费,ACOS");
  assert.equal(lines[1], '"A,""B""\nC",12.34,0.2');
  assert.equal(lines[2], "空值,,");
});
