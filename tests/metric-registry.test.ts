import assert from "node:assert/strict";
import test from "node:test";
import { METRIC_REGISTRY, computeMetric, listMetricDefinitions, type ObservedMetrics } from "@/lib/metrics-registry";
import { aggregateMetrics, aggregateMetricsForCampaignGroups, enrichMetric } from "@/lib/metrics";
import type { PerformanceRow } from "@/lib/types";

const base: ObservedMetrics = { spend: 20, sales: 100, clicks: 25, impressions: 500, orders: 5 };
const zero: ObservedMetrics = { spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };

function row(o: ObservedMetrics): PerformanceRow {
  return {
    id: "r", campaignGroupId: "g", batchId: "b",
    campaignName: "c", adGroupName: "ag", keyword: "k", target: "t", matchType: "exact",
    currentBid: 1, status: "enabled", topOfSearchShare: 0, advertisedProductOrders: 0,
    otherProductOrders: 0, viewableImpressions: 0,
    ...o,
  };
}

test("指标字典覆盖全部派生指标且元数据可序列化", () => {
  const codes = ["acos", "roas", "ctr", "cpc", "cvr", "cpa", "acots", "asots"];
  for (const code of codes) {
    assert.ok(METRIC_REGISTRY[code as keyof typeof METRIC_REGISTRY], `缺指标 ${code}`);
  }
  const list = listMetricDefinitions();
  assert.equal(list.length, codes.length);
  for (const d of list) {
    assert.ok(d.code && d.name && d.formula && d.unit);
    assert.equal("compute" in d, false, "序列化元数据不应含函数");
  }
});

test("registry 公式与既有 enrichMetric 实现逐项 0 差异", () => {
  for (const code of ["acos", "roas", "ctr", "cpc", "cvr", "cpa", "acots", "asots"] as const) {
    assert.equal(computeMetric(code, base), enrichMetric(row(base), code), `${code} 非零分母不一致`);
  }
});

test("零分母语义保留：ACOS 为 null，其余指标 0 或回退 spend", () => {
  assert.equal(computeMetric("acos", zero), null);
  assert.equal(computeMetric("roas", zero), 0);
  assert.equal(computeMetric("ctr", zero), 0);
  assert.equal(computeMetric("cpc", zero), 0);
  assert.equal(computeMetric("cvr", zero), 0);
  assert.equal(computeMetric("cpa", zero), 0); // orders=0 回退 spend=0
  assert.equal(computeMetric("cpa", { ...zero, spend: 7 }), 7);
  assert.equal(enrichMetric(row(zero), "acos"), null);
  assert.equal(enrichMetric(row(zero), "roas"), 0);
});

test("聚合函数复用同一字典：口径与 enrichMetric 一致", () => {
  const rows = [row(base), row({ spend: 10, sales: 50, clicks: 10, impressions: 100, orders: 2 })];
  const snap = aggregateMetrics("g", "b", rows);
  const totals: ObservedMetrics = { spend: 30, sales: 150, clicks: 35, impressions: 600, orders: 7 };
  assert.equal(snap.acos, computeMetric("acos", totals));
  assert.equal(snap.roas, computeMetric("roas", totals));
  assert.equal(snap.cpc, computeMetric("cpc", totals));
  const multi = aggregateMetricsForCampaignGroups(["g"], rows);
  assert.equal(multi.ctr, computeMetric("ctr", totals));
  assert.equal(multi.cvr, computeMetric("cvr", totals));
});

test("原始字段指标仍从 row 读取，未被字典误判", () => {
  assert.equal(enrichMetric(row(base), "sales"), 100);
  assert.equal(enrichMetric(row(base), "spend"), 20);
  assert.equal(enrichMetric(row(base), "orders"), 5);
  assert.equal(enrichMetric(row(base), "unknown_field"), null);
});
