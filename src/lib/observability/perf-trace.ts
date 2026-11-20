/**
 * M0 服务端分段耗时 Trace（对齐规划 §14.3 时间分层、§4.2 DB/API/缓存/计算/网络/前端）。
 *
 * 设计原则：
 * - 轻量、同步启动、零外部依赖；只在本进程内累积，结构化 JSON 输出到日志。
 * - 不采集任何业务数据值，只记 phase 名称 + 耗时 + 维度（page/route/org/ws）。
 * - fail-silent：任何异常都不影响业务请求。
 * - 分段维度用可注入时钟，便于单测；真实环境用 performance.now()。
 */

export type TracePhase =
  | "middleware" | "auth" | "cache" | "db" | "compute" | "serialize" | "network" | "render";

export type TraceDimensions = {
  page?: string;
  route?: string;
  organizationId?: string;
  workspaceId?: string;
  requestId?: string;
};

export type SegmentRecord = {
  phase: TracePhase;
  durationMs: number;
};

export type TraceRecord = {
  scope: "perf.trace";
  at: string;
  totalMs: number;
  dimensions: TraceDimensions;
  segments: SegmentRecord[];
};

export type TraceSink = (record: TraceRecord) => void;

const defaultNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const defaultSink: TraceSink = (record) => {
  try { console.info(JSON.stringify(record)); } catch { /* fail-silent */ }
};

/** 计算分位数（P50/P95/P99），输入需为已排序数组。 */
export function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * 一次请求的分段 trace 句柄。
 * 用法：
 *   const t = startTrace({ route: "/api/sellfox/sales" }, { now, sink });
 *   const dbEnd = t.mark("db"); ... t.segment("db", dbEnd);
 *   ... t.finish("serialize");
 */
export function startTrace(dimensions: TraceDimensions = {}, options: {
  now?: () => number;
  sink?: TraceSink;
} = {}) {
  const now = options.now ?? defaultNow;
  const sink = options.sink ?? defaultSink;
  const started = now();
  const segments: SegmentRecord[] = [];
  let finished = false;

  return {
    /** 记录一个已完成分段：耗时 = now() - since。 */
    segment(phase: TracePhase, since: number) {
      if (finished) return;
      segments.push({ phase, durationMs: Math.max(0, now() - since) });
    },
    /** 返回当前时刻，供下一段 segment 使用。 */
    mark(): number { return now(); },
    /** 结束整条 trace 并输出。返回完整记录。 */
    finish(lastPhase?: TracePhase): TraceRecord {
      if (finished) {
        return { scope: "perf.trace", at: "", totalMs: 0, dimensions, segments };
      }
      finished = true;
      if (lastPhase) segments.push({ phase: lastPhase, durationMs: 0 });
      const record: TraceRecord = {
        scope: "perf.trace",
        at: new Date().toISOString(),
        totalMs: Math.max(0, now() - started),
        dimensions,
        segments,
      };
      sink(record);
      return record;
    },
  };
}
