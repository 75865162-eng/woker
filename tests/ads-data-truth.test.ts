import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMetrics, aggregateMetricsForCampaignGroups, enrichMetric, formatPercent } from "@/lib/metrics";
import { evaluateConditionGroup } from "@/lib/rule-engine/engine";
import { createPpcAnalyticsAdapter } from "@/lib/agent-platform/ppc";
import type { PerformanceRow } from "@/lib/types";
import type { JsonObject } from "@/lib/agent-platform/types";

const row: PerformanceRow = {
  id: "truth-row", campaignGroupId: "truth-group", batchId: "truth-batch",
  campaignName: "真实导入活动", adGroupName: "真实导入广告组", keyword: "organizer",
  target: "organizer", matchType: "exact", currentBid: 1, status: "enabled",
  impressions: 100, clicks: 30, orders: 0, sales: 0, spend: 20,
  topOfSearchShare: 0, advertisedProductOrders: 0, otherProductOrders: 0, viewableImpressions: 0,
};

test("PPC必需观测指标缺失时明确拒绝，null空白和布尔值不伪装成零", async () => {
  const adapter = createPpcAnalyticsAdapter();
  const required = ["currentBid", "impressions", "clicks", "orders", "sales", "spend", "topOfSearchShare", "advertisedProductOrders", "otherProductOrders", "viewableImpressions"];
  for (const source of ["performanceRows", "overallAdDataRows"]) {
    const fields = source === "performanceRows" ? required : required.slice(1, 6);
    for (const field of fields) for (const value of [undefined, null, "", "  ", false, "invalid"]) {
      const invalid: JsonObject = { ...row };
      if (value === undefined) delete invalid[field]; else invalid[field] = value;
      await assert.rejects(() => adapter.execute({ executionId: "missing-metric", toolId: "ppc.ads.snapshot", context: {}, input: { [source]: [invalid] } }), new RegExp(`NEEDS_DATA.*${source}.*${field}`));
    }
  }
});

test("PPC保留显式真零与数值字符串，零销售ACOS仍未知", async () => {
  const adapter = createPpcAnalyticsAdapter();
  const zero = { ...row, currentBid: 0, impressions: 0, clicks: 0, spend: 0 };
  const result = await adapter.execute({ executionId: "zero-metric", toolId: "ppc.ads.snapshot", context: {}, input: { performanceRows: [{ ...zero, impressions: "0" }] } });
  const output = result.output as { metrics: { impressions: number; clicks: number; spend: number; acos: null } };
  assert.equal(output.metrics.impressions, 0);
  assert.equal(output.metrics.clicks, 0);
  assert.equal(output.metrics.spend, 0);
  assert.equal(output.metrics.acos, null);
});

test("零销售与空聚合的ACOS保留null，不编造999或零", () => {
  for (const spend of [0, 20]) {
    const input = { ...row, spend };
    assert.equal(enrichMetric(input, "acos"), null);
    assert.equal(aggregateMetrics(row.campaignGroupId, row.batchId, [input]).acos, null);
    assert.equal(aggregateMetricsForCampaignGroups([row.campaignGroupId], [input]).acos, null);
  }
  assert.equal(aggregateMetricsForCampaignGroups([], []).acos, null);
  assert.equal(enrichMetric({ ...row, sales: 100, spend: 0 }, "acos"), 0);
  assert.equal(enrichMetric({ ...row, sales: 100 }, "acos"), 20);
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(0), "0.0%");
});

test("聚合与单行派生拒绝未观测数值，未知指标保留null", () => {
  for (const field of ["sales", "spend", "orders", "impressions", "clicks"]) {
    for (const value of [undefined, null, NaN, Infinity]) {
      const missing = { ...row, [field]: value } as PerformanceRow;
      assert.throws(() => aggregateMetrics(row.campaignGroupId, row.batchId, [missing]), /NEEDS_DATA/);
      assert.throws(() => aggregateMetricsForCampaignGroups([row.campaignGroupId], [missing]), /NEEDS_DATA/);
      assert.throws(() => enrichMetric(missing, "acos"), /NEEDS_DATA/);
    }
  }
  assert.equal(enrichMetric(row, "unknown-metric"), null);
});

test("未知ACOS不命中高值低值或跨源比较规则，点击控损规则保留", () => {
  const context = { bulkRow: row, currentBid: 1, campaignOverallRows: [], isCoreKeyword: false };
  for (const operator of ["gt", "lt", "eq"] as const) {
    assert.equal(evaluateConditionGroup(context, { id: operator, logic: "AND", conditions: [{ id: "acos", metric: "acos", operator, value: operator === "gt" ? 100 : 30 }] }), false);
  }
  assert.equal(evaluateConditionGroup(context, { id: "waste", logic: "AND", conditions: [{ id: "clicks", metric: "clicks", operator: "gt", value: 20 }] }), true);
});

test("PPC零销售快照不提供高效词扩量或上调竞价，仍保留零订单控损", async () => {
  const adapter = createPpcAnalyticsAdapter();
  const input = { performanceRows: [row], marketplace: "US", targetMargin: 40, targetAcos: 30 };
  const execute = async (toolId: string, rows = input.performanceRows) => {
    const result = await adapter.execute({ executionId: "truth-execution", toolId, context: {}, input: { ...input, performanceRows: rows.map(row => ({ ...row })) } });
    return result.output as Record<string, unknown>;
  };
  const snapshot = await execute("ppc.ads.snapshot");
  assert.equal((snapshot.metrics as Record<string, unknown>).acos, null);
  const diagnosis = (await execute("ppc.diagnosis.analyze")).diagnosis as Array<{ issue: string }>;
  assert.ok(diagnosis.some(item => item.issue === "存在高点击零订单浪费"));
  assert.ok(!diagnosis.some(item => /高效词|支持加码/.test(item.issue)));
  const bids = (await execute("ppc.bid.recommend")).bidRecommendations as Array<{ suggestedBid: number }>;
  assert.ok(bids.every(item => item.suggestedBid <= row.currentBid));
  const inconsistent = [{ ...row, orders: 1 }];
  const inconsistentDiagnosis = (await execute("ppc.diagnosis.analyze", inconsistent)).diagnosis as Array<{ issue: string }>;
  assert.ok(!inconsistentDiagnosis.some(item => /高效词|支持加码/.test(item.issue)));
});
