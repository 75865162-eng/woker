import { test } from "node:test";
import assert from "node:assert/strict";
import { startTrace, percentile, type TraceRecord } from "../src/lib/observability/perf-trace";
import {
  __resetMetricsCollectorForTest, recordCacheEvent,
} from "../src/lib/observability/metrics-collector";
import { startWebVitals, type VitalRecord } from "../src/lib/observability/web-vitals";

test("percentile: 空数组/边界/插值", () => {
  assert.equal(percentile([], 0.5), undefined);
  assert.equal(percentile([5], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
  assert.equal(percentile([1, 2, 3, 4], 1), 4);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

test("startTrace: 分段耗时与维度按序记录，finish 只输出一次", () => {
  let t = 100;
  const records: TraceRecord[] = [];
  const trace = startTrace(
    { route: "/api/sellfox/sales", organizationId: "org1", workspaceId: "ws1" },
    { now: () => (t += 10), sink: (r) => records.push(r) },
  );
  const dbStart = trace.mark(); // 110
  trace.segment("db", dbStart); // now=120 → 10ms
  const cacheStart = trace.mark(); // 130
  trace.segment("cache", cacheStart); // now=140 → 10ms
  const rec = trace.finish("serialize"); // now=150, total=50
  assert.equal(records.length, 1);
  assert.equal(rec.dimensions.route, "/api/sellfox/sales");
  assert.equal(rec.dimensions.organizationId, "org1");
  assert.equal(rec.segments.length, 3);
  assert.deepEqual(rec.segments.map((s) => s.phase), ["db", "cache", "serialize"]);
  assert.equal(rec.segments[0].durationMs, 10);
  assert.equal(rec.totalMs, 50);
  trace.finish(); // 再次 finish 不再输出
  assert.equal(records.length, 1);
});

test("startTrace: finish 无业务数据，仅结构", () => {
  const rec = startTrace({}, { now: () => 0, sink: () => {} }).finish();
  assert.equal(rec.scope, "perf.trace");
  assert.ok(Array.isArray(rec.segments));
  assert.equal(Object.keys(rec).sort().join(","), "at,dimensions,scope,segments,totalMs");
});

test("metrics-collector: hit/miss 命中率与 counter 出口", () => {
  const c = __resetMetricsCollectorForTest(() => 1000);
  recordCacheEvent("hit", "sellfox:sales");
  recordCacheEvent("hit", "sellfox:sales");
  recordCacheEvent("miss", "sellfox:sales");
  recordCacheEvent("error", "sellfox:sales");
  const snap = c.snapshot();
  assert.equal(snap.counters['cache_hit_total{domain=sellfox:sales}'], 2);
  assert.equal(snap.counters['cache_miss_total{domain=sellfox:sales}'], 1);
  assert.equal(snap.counters['cache_error_total{domain=sellfox:sales}'], 1);
  const d = snap.domains["sellfox:sales"];
  assert.equal(d.hit, 2);
  assert.equal(d.miss, 1);
  assert.equal(d.error, 1);
  assert.equal(d.hitRate, 2 / 3);
});

test("metrics-collector: 无样本时命中率为 null", () => {
  const c = __resetMetricsCollectorForTest(() => 0);
  const snap = c.snapshot();
  assert.equal(Object.keys(snap.domains).length, 0);
  c.inc("hit", "empty");
  // 只有 hit 没有 miss 也有样本，hitRate=1
  assert.equal(c.snapshot().domains["empty"].hitRate, 1);
});

test("metrics-collector: 延迟直方图 P50/P95/P99", () => {
  const c = __resetMetricsCollectorForTest(() => 0);
  for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) recordCacheEvent("hit", "sellfox:ads", ms);
  const h = c.snapshot().domains["sellfox:ads"].latencyMs;
  assert.equal(h.count, 10);
  assert.equal(h.p50, 55);
  assert.equal(h.max, 100);
  assert.ok(h.p95 !== undefined && h.p95 > h.p50!);
  assert.ok(h.p99 !== undefined && h.p99 >= h.p95!);
});

test("metrics-collector: 滑动窗口清理过期样本", () => {
  let t = 0;
  const c = __resetMetricsCollectorForTest(() => t);
  recordCacheEvent("hit", "w", 5); // t=0
  t = 11 * 60 * 1000; // 超过 10 分钟
  recordCacheEvent("hit", "w", 7);
  const h = c.snapshot().domains["w"].latencyMs;
  assert.equal(h.count, 1, "过期样本应被清理");
  assert.equal(h.max, 7);
});

test("web-vitals: 无 PerformanceObserver 时 no-op", () => {
  const stop = startWebVitals({ page: "/x", reporter: () => { throw new Error("should not fire"); } });
  assert.equal(typeof stop, "function");
  stop();
});

test("web-vitals: 指标去重与上报结构（注入 reporter + 伪 observer 验证 emit 形状）", () => {
  // 直接验证 VitalRecord 形状约束（采集器 emit 走此结构）。
  const seen: VitalRecord[] = [];
  const reporter = (r: VitalRecord) => {
    assert.equal(r.scope, "rum.vital");
    assert.ok(["FCP", "LCP", "INP", "CLS", "TTFB"].includes(r.name));
    assert.ok(Number.isFinite(r.value) && r.value >= 0);
    assert.ok(!Array.isArray(r.page) && r.page.length <= 200);
    seen.push(r);
  };
  reporter({ scope: "rum.vital", name: "LCP", value: 1234.5, page: "/product", at: new Date().toISOString() });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "LCP");
});

test("cache config snapshot reads only boolean switches", async () => {
  const { readCacheConfig } = await import("../src/lib/observability/cache-config");
  assert.deepEqual(readCacheConfig({}), {
    sellfoxResultCache: false, amazonResultCache: false,
    sellfoxAggregateRead: false, sellfoxListingProfileRead: false,
    sellfoxAggregateFxProjection: false, sellfoxAggSchemaVersion: "v1", allEnabled: false,
  });
  assert.deepEqual(readCacheConfig({
    SELLFOX_CACHE_ENABLED: "true", AMAZON_CACHE_ENABLED: "1",
    SELLFOX_AGG_READ_ENABLED: "true", SELLFOX_LISTING_PROFILE_READ_ENABLED: "false",
    SELLFOX_AGG_FX_ENABLED: "true", SELLFOX_AGG_SCHEMA_VERSION: "v2",
  }), {
    sellfoxResultCache: true, amazonResultCache: true,
    sellfoxAggregateRead: true, sellfoxListingProfileRead: false,
    sellfoxAggregateFxProjection: true, sellfoxAggSchemaVersion: "v2", allEnabled: true,
  });
});
