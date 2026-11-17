/**
 * 数据质量指标的纯计算函数（审计 6.4）。
 *
 * 设计原则：
 * - 纯函数，输入已聚合的数字/行，不依赖数据库与运行时，便于单测。
 * - 缺失数据保留 null，不补零、不伪造（如无样本时空值率为 null）。
 * - 对账趋势只展示已结构化的 reconciliation 字段；真实三方对账结论须在预发完成。
 */

export type NullRate = { total: number; nullCount: number; rate: number | null };

/** 计算字段空值率。分母为 0 时 rate 返回 null（不补零）。 */
export function computeNullRate(total: number, nullCount: number): NullRate {
  const t = Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;
  const n = Number.isFinite(nullCount) && nullCount >= 0 && nullCount <= t ? Math.floor(nullCount) : 0;
  return { total: t, nullCount: n, rate: t === 0 ? null : Math.round((n / t) * 10_000) / 10_000 };
}

export const LATENCY_BUCKETS = [
  { label: "<1s", min: 0, max: 1_000 },
  { label: "1-5s", min: 1_000, max: 5_000 },
  { label: "5-30s", min: 5_000, max: 30_000 },
  { label: "30s-2m", min: 30_000, max: 120_000 },
  { label: ">=2m", min: 120_000, max: Number.POSITIVE_INFINITY },
] as const;

export type LatencyBucket = { label: string; count: number };

/** 同步耗时分桶。无效/负数耗时被忽略；空样本返回全 0 桶且 sampleSize=0。 */
export function bucketLatency(durationsMs: readonly number[]): { buckets: LatencyBucket[]; sampleSize: number } {
  const buckets = LATENCY_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  let sampleSize = 0;
  for (const duration of durationsMs) {
    if (!Number.isFinite(duration) || duration < 0) continue;
    sampleSize += 1;
    let index = buckets.length - 1;
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      if (duration >= LATENCY_BUCKETS[i].min && duration < LATENCY_BUCKETS[i].max) {
        index = i;
        break;
      }
    }
    buckets[index].count += 1;
  }
  return { buckets, sampleSize };
}

export type ReconciliationPoint = {
  at: string | null;
  resource: string | null;
  persisted: number | null;
  received: number | null;
  requested: number | null;
  dropped: number | null;
};

type ReconciliationRunLike = {
  summary: unknown;
  finishedAt: Date | null;
  resource?: string | null;
};

function asNonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * 从已完成 run 的 summary.reconciliation 提取对账时间序列。
 * 没有结构化 reconciliation 的历史 run 直接跳过（不补零、不伪造四值）。
 * 结果按 finishedAt 升序，便于观察差异趋势。
 */
export function buildReconciliationTrend(runs: readonly ReconciliationRunLike[]): ReconciliationPoint[] {
  const points: ReconciliationPoint[] = [];
  for (const run of runs) {
    const summary = run.summary && typeof run.summary === "object" ? run.summary as Record<string, unknown> : null;
    const rec = summary?.reconciliation && typeof summary.reconciliation === "object"
      ? summary.reconciliation as Record<string, unknown>
      : null;
    if (!rec) continue;
    points.push({
      at: run.finishedAt ? run.finishedAt.toISOString() : null,
      resource: run.resource ?? null,
      persisted: asNonNegativeInt(rec.persisted),
      received: asNonNegativeInt(rec.received),
      requested: asNonNegativeInt(rec.requested),
      dropped: asNonNegativeInt(rec.dropped),
    });
  }
  return points.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}
