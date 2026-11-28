/**
 * 纯函数判定层：给定注册表、心跳行、期望版本和当前时间，算出哪些 Worker
 * 需要被看门狗拉起。无 IO、无副作用，便于单元测试。
 *
 * 判定口径与 worker-health / production-readiness 保持一致：
 *   - 有效在线心跳 = status=online 且 lastSeenAt 在 [now - staleMs, now + skewMs]
 *   - 版本一致 = 至少一条有效心跳的 metadata.version === expectedVersion
 *   - 队列就绪 = 至少一条有效心跳 metadata.queueReady === true（无该字段视为未知，不判故障）
 *
 * 关键设计：只把「确实离线」或「版本陈旧」的 Worker 列为需重启；判定失败时
 * 宁可少动（交给人/告警），也不误重启正在正常工作但对时钟轻微偏移的实例。
 */
export const DEFAULT_STALE_MS = 5 * 60_000;
export const DEFAULT_SKEW_MS = 5_000;

export function workerWatchdogDecisions(registry, rows, options = {}) {
  const {
    now = Date.now(),
    staleMs = DEFAULT_STALE_MS,
    skewMs = DEFAULT_SKEW_MS,
    expectedVersion = null,
    // 每个 worker 距上次自动拉起的最小间隔，避免服务反复起不来时被疯狂 restart。
    minRestartIntervalMs = 3 * 60_000,
    lastRestartAt = {},
  } = options;
  const decisions = [];
  for (const worker of registry) {
    const queue = worker.heartbeatQueue;
    const relevant = rows.filter(row => row.queueName === queue);
    const timestamps = relevant
      .map(row => ({ row, t: new Date(row.lastSeenAt).getTime() }))
      .filter(({ t }) => Number.isFinite(t));
    const online = timestamps.filter(({ row, t }) =>
      row.status === "online" && t >= now - staleMs && t <= now + skewMs);

    let reason = null;
    if (online.length === 0) {
      reason = relevant.length === 0
        ? "NO_HEARTBEAT"          // 完全没有心跳记录（进程从未起来 / 被停）
        : "HEARTBEAT_STALE";      // 有记录但已过期（进程停摆）
    } else if (expectedVersion && !online.some(({ row }) => row.metadata?.version === expectedVersion)) {
      reason = "VERSION_STALE";   // 心跳在线但仍是旧代码
    }

    const last = Number(lastRestartAt[worker.id] ?? 0);
    const coolingDown = Number.isFinite(last) && now - last < minRestartIntervalMs;
    const shouldRestart = Boolean(reason) && !coolingDown;

    decisions.push({
      id: worker.id,
      service: worker.service ?? worker.id,
      queue,
      reason,
      online: online.length > 0,
      versionOk: expectedVersion ? online.some(({ row }) => row.metadata?.version === expectedVersion) : null,
      coolingDown,
      shouldRestart,
    });
  }
  return decisions;
}

/** 人类可读的一句话汇总，供日志与告警使用。 */
export function formatWatchdogSummary(decisions) {
  const bad = decisions.filter(d => d.reason);
  if (!bad.length) return `全部 ${decisions.length} 个 Worker 心跳正常`;
  return bad.map(d => `${d.id}(${d.reason}${d.coolingDown ? "·冷却中" : "·将重启"})`).join("；");
}
