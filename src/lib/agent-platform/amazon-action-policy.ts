import { createHash } from "node:crypto";
import type { AmazonAdsExecutionPlan } from "./amazon-ads";

export class AmazonActionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export function assertAction(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new AmazonActionError(code, message, status);
}
export function actionKey(value: unknown) {
  assertAction(typeof value === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(value), "INVALID_IDEMPOTENCY_KEY", "idempotencyKey 必须是 8–160 位字母、数字、冒号、下划线或连字符。", 400);
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function actionDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function validateBidPlan(plan: AmazonAdsExecutionPlan) {
  assertAction(Array.isArray(plan.operations) && plan.operations.length > 0 && plan.operations.length <= 100, "INVALID_BATCH", "本轮仅允许 1–100 条 update_bid。", 400);
  const targets = new Set<string>(); const warnings: string[] = [];
  for (const row of plan.operations) {
    assertAction(row.operationType === "update_bid", "UNSUPPORTED_OPERATION", "本轮仅开放 update_bid 审批预览；否定词和结构建议仍为报告。", 400);
    assertAction(typeof row.target === "string" && row.target.length > 0 && row.target.length <= 200 && !targets.has(row.target), "INVALID_TARGET", "目标必须非空且不可重复。", 400);
    targets.add(row.target);
    const payload = row.payload as Record<string, unknown>;
    assertAction(payload && typeof payload === "object" && !Array.isArray(payload), "INVALID_BID", "竞价参数无效。", 400);
    const oldBid = payload.currentBid; const newBid = payload.suggestedBid;
    assertAction(typeof oldBid === "number" && Number.isFinite(oldBid) && oldBid >= 0.02 && oldBid <= 100 && typeof newBid === "number" && Number.isFinite(newBid) && newBid >= 0.02 && newBid <= 100, "INVALID_BID", "old/new bid 必须在 [0.02, 100] 内；执行前须按站点和币种复核。", 400);
    if (Math.abs(newBid / oldBid - 1) > 0.5) warnings.push(`${row.target}: 出价变动超过 50%，需人工重点复核。`);
  }
  return warnings;
}
export function assertNotExpired(expiresAt: Date | null | undefined, now: Date) {
  assertAction(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime(), "EXPIRED", "预览/审批已过期，请重新生成。", 410);
}
