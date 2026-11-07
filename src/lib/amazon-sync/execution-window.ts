import { SyncInputError } from "./policy";
/** An application-time bounded window, separate from request/approval expiry. */
export const executionWindowMs = 24 * 60 * 60_000;
export function executionDeadline(frozen: unknown): Date {
  const value = (frozen as { executionExpiresAt?: unknown } | null)?.executionExpiresAt;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SyncInputError("执行授权缺少有效截止时间，须重新申请。", 403);
  return new Date(value);
}
export function assertExecutionWindow(frozen: unknown, now = new Date()) {
  if (executionDeadline(frozen) <= now) throw new SyncInputError("执行授权已过期，须重新审批。", 403);
}
