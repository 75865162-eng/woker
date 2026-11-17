/**
 * 同步条数对账基础结构。
 *
 * 目标：在 run.summary 中结构化记录"入库数"，并在上游确实提供了返回条数时一并记录；
 * 对拿不到的字段保留 null（遵循"缺失数据不补零、不伪造"的工程纪律），
 * 不虚构"请求/丢弃"数值。真实的三方对账结论仍须在预发用真实平台数据完成。
 */
export type SellfoxReconciliation = {
  persisted: number | null;
  received: number | null;
  requested: number | null;
  dropped: number | null;
  note: string;
};

function firstNonNegativeInt(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return null;
}

export function buildSellfoxReconciliation(result: unknown, progress?: unknown): SellfoxReconciliation {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const p = (progress && typeof progress === "object" ? progress : {}) as Record<string, unknown>;

  // 入库数：各资源写入字段不一，按可信度依次取。
  const persisted = firstNonNegativeInt(r.writes, r.synced, r.count, p.count);

  // 返回条数：仅当同步函数在 result 中明确暴露 rows/received 时记录，否则 null。
  const received = firstNonNegativeInt(r.rows, r.received, r.returned);

  // 请求与丢弃：当前上游未提供稳定口径，明确留空，绝不伪造。
  const requested = null;
  const dropped = received !== null && persisted !== null && received >= persisted
    ? received - persisted
    : null;

  return {
    persisted,
    received,
    requested,
    dropped,
    note: persisted === null
      ? "入库数未从同步结果中获得，需核对 run.summary.result。"
      : "persisted=成功入库条数；received=上游返回条数（如可得）；requested/dropped 缺失保留 null，真实对账须在预发完成。",
  };
}
