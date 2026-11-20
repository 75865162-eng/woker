/**
 * M0 前端 RUM / Web Vitals 埋点骨架（对齐规划 §14.1 Metrics、§4.2 前端渲染分层）。
 *
 * - 采集 FCP / LCP / INP / CLS / TTFB 五项核心指标。
 * - 用 PerformanceObserver，页面卸载时用 sendBeacon 上报（不阻塞、不丢样本）。
 * - 只上报指标数值 + page 维度，不含业务数据或 PII。
 * - 浏览器不支持时静默降级；SSR 环境下 startWebVitals 为 no-op。
 */

export type VitalName = "FCP" | "LCP" | "INP" | "CLS" | "TTFB";

export type VitalRecord = {
  scope: "rum.vital";
  name: VitalName;
  value: number;
  page: string;
  at: string;
};

export type VitalReporter = (record: VitalRecord) => void;

export type StartOptions = {
  page: string;
  reporter?: VitalReporter;
  /** 测试/自定义：注入 performance 对象。 */
  perf?: Performance | undefined;
};

function defaultReporter(record: VitalRecord): void {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      navigator.sendBeacon("/api/observability/vitals", new Blob([JSON.stringify(record)], { type: "application/json" }));
      return;
    } catch { /* fall through */ }
  }
  try { console.info(JSON.stringify(record)); } catch { /* fail-silent */ }
}

/**
 * 启动 Web Vitals 采集。返回一个停止函数（移除 observer）。
 * SSR / 无 PerformanceObserver 时返回 no-op。
 */
export function startWebVitals(options: StartOptions): () => void {
  const perf = options.perf ?? (typeof performance !== "undefined" ? performance : undefined);
  if (!perf || typeof (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver === "undefined") {
    return () => {};
  }
  const reporter = options.reporter ?? defaultReporter;
  const PO = (globalThis as { PerformanceObserver: typeof PerformanceObserver }).PerformanceObserver;
  const observers: PerformanceObserver[] = [];
  const seen = new Set<VitalName>();

  const emit = (name: VitalName, value: number) => {
    if (!Number.isFinite(value) || seen.has(name)) return;
    seen.add(name);
    reporter({ scope: "rum.vital", name, value, page: options.page, at: new Date().toISOString() });
  };

  const observe = (type: string, handler: (entries: PerformanceEntryList) => void) => {
    try {
      const obs = new PO((list) => handler(list.getEntries()));
      obs.observe({ type, buffered: true } as PerformanceObserverInit);
      observers.push(obs);
    } catch { /* 该 type 不支持时忽略 */ }
  };

  // FCP / LCP
  observe("paint", (entries) => {
    for (const e of entries) {
      if (e.name === "first-contentful-paint") emit("FCP", e.startTime);
    }
  });
  observe("largest-contentful-paint", (entries) => {
    for (const e of entries) emit("LCP", e.startTime);
  });
  // CLS（累计 layout shift）
  observe("layout-shift", (entries) => {
    let cls = 0;
    for (const e of entries) {
      const shift = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
      if (!shift.hadRecentInput && typeof shift.value === "number") cls += shift.value;
    }
    if (cls > 0) emit("CLS", cls);
  });
  // INP（交互到下一帧）
  observe("event", (entries) => {
    let max = 0;
    for (const e of entries) {
      const ev = e as PerformanceEntry & { duration?: number };
      if (typeof ev.duration === "number") max = Math.max(max, ev.duration);
    }
    if (max > 0) emit("INP", max);
  });
  // TTFB（导航时序）
  observe("navigation", (entries) => {
    for (const e of entries) {
      const nav = e as PerformanceEntry & { responseStart?: number; requestStart?: number };
      if (typeof nav.responseStart === "number") emit("TTFB", nav.responseStart - (nav.requestStart ?? 0));
    }
  });

  return () => { for (const o of observers) { try { o.disconnect(); } catch { /* noop */ } } };
}
