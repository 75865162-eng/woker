/**
 * M0 统一指标收集器（对齐规划 §14.2 Metrics / §6.4 缓存命中率监控）。
 *
 * - Counter：`cache_hit_total{domain}` / `cache_miss_total{domain}` / `cache_error_total{domain}`
 * - Histogram：缓存读取延迟（滑动窗口），提供 P50/P95/P99 与命中率出口
 * - 进程内环形缓冲，仅作观测，不影响业务；可注入 now 便于单测
 * - 不采集业务数据值，只采集指标维度（domain）
 *
 * 现状 result-cache 的 console.info 保留兼容；本模块提供可聚合出口，
 * 供管理页 / 健康检查 / 后续 Prometheus 端点读取。
 */

export type CacheEvent = "hit" | "miss" | "error";

export type CounterSnapshot = Record<string, number>;

export type HistogramSnapshot = {
  count: number;
  p50?: number;
  p95?: number;
  p99?: number;
  max?: number;
};

export type DomainMetrics = {
  hit: number;
  miss: number;
  error: number;
  hitRate: number | null; // hit / (hit+miss)，无样本时 null
  latencyMs: HistogramSnapshot;
};

export type MetricsSnapshot = {
  scope: "m0.metrics";
  at: string;
  counters: CounterSnapshot;
  domains: Record<string, DomainMetrics>;
};

type WindowSample = { at: number; ms: number };

const WINDOW_MS = 10 * 60 * 1000; // 10 分钟滑动窗口
const MAX_SAMPLES = 5000;

class Collector {
  private counters = new Map<string, number>();
  private latency = new Map<string, WindowSample[]>();
  constructor(private now: () => number) {}

  inc(event: CacheEvent, domain: string): void {
    const key = `cache_${event}_total{domain=${domain}}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  observeLatency(domain: string, ms: number): void {
    const arr = this.latency.get(domain) ?? [];
    const t = this.now();
    // 清理过期样本
    while (arr.length && t - arr[0].at > WINDOW_MS) arr.shift();
    arr.push({ at: t, ms: Math.max(0, ms) });
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
    this.latency.set(domain, arr);
  }

  private hist(domain: string): HistogramSnapshot {
    const arr = this.latency.get(domain) ?? [];
    if (!arr.length) return { count: 0 };
    const sorted = arr.map((s) => s.ms).sort((a, b) => a - b);
    const q = (p: number) => {
      const idx = (sorted.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    return {
      count: sorted.length,
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      max: sorted[sorted.length - 1],
    };
  }

  snapshot(): MetricsSnapshot {
    const domainNames = new Set<string>();
    for (const key of this.counters.keys()) {
      const m = /\{domain=([^}]+)\}/.exec(key);
      if (m) domainNames.add(m[1]);
    }
    for (const d of this.latency.keys()) domainNames.add(d);

    const domains: Record<string, DomainMetrics> = {};
    for (const d of domainNames) {
      const hit = this.counters.get(`cache_hit_total{domain=${d}}`) ?? 0;
      const miss = this.counters.get(`cache_miss_total{domain=${d}}`) ?? 0;
      const error = this.counters.get(`cache_error_total{domain=${d}}`) ?? 0;
      const total = hit + miss;
      domains[d] = {
        hit, miss, error,
        hitRate: total > 0 ? hit / total : null,
        latencyMs: this.hist(d),
      };
    }
    const counters: CounterSnapshot = {};
    for (const [k, v] of this.counters) counters[k] = v;
    return { scope: "m0.metrics", at: new Date().toISOString(), counters, domains };
  }

  reset(): void {
    this.counters.clear();
    this.latency.clear();
  }
}

let globalCollector: Collector | undefined;

export function getMetricsCollector(): Collector {
  if (!globalCollector) globalCollector = new Collector(() => Date.now());
  return globalCollector;
}

/** 测试用：注入时钟并重置全局收集器。 */
export function __resetMetricsCollectorForTest(now: () => number = () => Date.now()): Collector {
  globalCollector = new Collector(now);
  return globalCollector;
}

/** 便捷函数：记录一次缓存事件（命中/未命中/错误）。 */
export function recordCacheEvent(event: CacheEvent, domain: string, latencyMs?: number): void {
  const c = getMetricsCollector();
  c.inc(event, domain);
  if (typeof latencyMs === "number") c.observeLatency(domain, latencyMs);
}
