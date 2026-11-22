import assert from "node:assert/strict";
import test from "node:test";
import {
  ADS_ADVANCED_METRICS,
  advancedMetricPreviewColumns,
  advancedMetricsSummary,
} from "../src/lib/sellfox/ads-advanced-metrics";
import { hostDataset } from "../src/lib/sellfox/host-pages";

test("高级指标注册表全部未启用、证据状态仅为待验证/未决", () => {
  assert.ok(ADS_ADVANCED_METRICS.length > 0);
  const keys = new Set<string>();
  for (const metric of ADS_ADVANCED_METRICS) {
    assert.ok(!keys.has(metric.key), `重复 key：${metric.key}`);
    keys.add(metric.key);
    assert.equal(metric.enabled, false, `${metric.key} 不得启用`);
    assert.ok(["待验证", "未决"].includes(metric.evidenceStatus), `${metric.key} 证据状态不合法`);
    // 未核实前不得产出任何来源/适用类型/归因/聚合断言。
    assert.deepEqual(metric.sources, [], `${metric.key} 来源未核实，必须为空`);
    assert.deepEqual(metric.applicableAdTypes, [], `${metric.key} 适用广告类型未核实，必须为空`);
    assert.equal(metric.attributionWindow, null);
    assert.equal(metric.dateGrain, null);
    assert.equal(metric.aggregation, null);
    assert.equal(metric.filterable, false);
    assert.equal(metric.sortable, false);
    assert.equal(metric.exportable, false);
    assert.match(metric.nullPolicy, /NEEDS_DATA/);
  }
});

test("四个缩写指标登记为未决且不猜分子分母名称", () => {
  for (const key of ["acots", "asots", "acoas", "asoas"]) {
    const metric = ADS_ADVANCED_METRICS.find((m) => m.key === key)!;
    assert.ok(metric, `${key} 必须登记`);
    assert.equal(metric.evidenceStatus, "未决");
    assert.equal(metric.valueType, "unknown");
    for (const item of ["分子", "分母", "广告范围", "名称"]) assert.ok(metric.unresolved.includes(item));
  }
});

test("汇总计数与列表一致，启用数为 0", () => {
  const s = advancedMetricsSummary();
  assert.equal(s.total, ADS_ADVANCED_METRICS.length);
  assert.equal(s.pending + s.unresolved, s.total);
  assert.equal(s.enabled, 0);
});

test("预览列只含 key/label，不含任何数据值", () => {
  const cols = advancedMetricPreviewColumns();
  assert.equal(cols.length, ADS_ADVANCED_METRICS.length);
  for (const col of cols) {
    assert.deepEqual(Object.keys(col).sort(), ["key", "label"]);
  }
});

test("高级指标在承接页为 blocked 待接数据集，无读取路径", async () => {
  const found = hostDataset("ads_advanced_metrics");
  assert.ok(found, "ads_advanced_metrics 必须挂载到承接页");
  assert.equal(found.dataset.status, "blocked");
  assert.equal(found.dataset.reader ?? found.dataset.endpoint ?? found.dataset.rawCode, undefined);
  assert.match(found.dataset.note ?? "", /待验证|未决|不产出数值|0/);
});
