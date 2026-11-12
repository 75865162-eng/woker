/** Read-only diagnostic. A timestamp cannot prove Worker liveness or completeness. */
export const orderProgressGraceMs = 15 * 60_000;
export const orderProgressEvents = ["ORDER_PAGE_COMMITTED", "ORDER_DETAIL_COMMITTED", "ORDER_WINDOW_COMPLETED"];
export function orderProgress(task: {
  status: string; startedAt: Date; executionStartedAt: Date | null; updatedAt: Date;
  nextAttemptAt: Date; leaseExpiresAt: Date | null; frozenScope: unknown;
}, lastCommitAt: Date | null, now = new Date()) {
  const lastProgressAt = lastCommitAt ?? task.executionStartedAt ?? task.startedAt;
  const frozen = task.frozenScope as { executionExpiresAt?: unknown } | null;
  const expiry = typeof frozen?.executionExpiresAt === "string" ? Date.parse(frozen.executionExpiresAt) : NaN;
  const result = (state: string, message: string, needsAttention = false) => ({ state, message, needsAttention,
    checkedAt: now.toISOString(), lastProgressAt: lastProgressAt.toISOString(),
    progressBasis: lastCommitAt ? "COMMITTED_PAGE_OR_DETAIL" : "EXECUTION_OR_QUEUE_START", graceSeconds: orderProgressGraceMs / 1000 });
  if (["SUCCEEDED", "CANCELLED"].includes(task.status)) return result("FINISHED", "任务已结束；当前窗口完成不代表全部历史明细完整。");
  if (["FAILED", "BLOCKED", "PARTIAL_SUCCESS"].includes(task.status)) return result("ACTION_REQUIRED", "任务需要人工核对，恢复仍须通过现有审批。", true);
  if (task.status === "PAUSED") return result("PAUSED", "任务已暂停，检查点保留；经审批恢复后继续。");
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return result("EXECUTION_APPROVAL_REQUIRED", "执行授权已过期或缺失，须重新审批；不要重置游标。", true);
  if (task.status === "RUNNING") {
    if (!task.leaseExpiresAt || task.leaseExpiresAt <= now) return result("LEASE_RECOVERY_REQUIRED", "执行租约已过期或缺失，需检查注册 Worker 的租约恢复；不要重复创建任务。", true);
    if (now.getTime() - lastProgressAt.getTime() >= orderProgressGraceMs) return result("POSSIBLE_STALL", "较长时间没有提交新页或明细；租约仍有效，请核对 Worker 和请求日志。", true);
    return result("RUNNING", "任务正在执行；以已提交页和明细为进度依据。");
  }
  if (["WAITING", "QUEUED", "RETRY_WAIT", "RECOVERING"].includes(task.status)) {
    if (task.nextAttemptAt > now) return result("SCHEDULED_WAIT", "尚未到下次执行时间，可能处于持久限流或重试退避。");
    // A long intentional wait does not count as overdue until its due time.
    const since = Math.max(task.nextAttemptAt.getTime(), task.updatedAt.getTime(), lastProgressAt.getTime());
    if (now.getTime() - since >= orderProgressGraceMs) return result("POSSIBLE_STALL", "任务已到执行时间且较长时间没有进展，请检查队列消费和注册 Worker；不要重复创建任务。", true);
    return result("READY", "任务等待队列调度，尚未超过进度观察阈值。");
  }
  return result("UNKNOWN", "无法判断当前执行状态，请查看任务详情。");
}
