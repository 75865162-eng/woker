import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { digest } from "./approval-policy";
import { orderCursorDigest, orderWindowFromFrozen, parseOrderSyncPolicy } from "./orders";
import { activeTaskStatuses, SyncInputError } from "./policy";
import type { OrderRecoveryReadiness } from "./contracts";

/** Read-only checkpoint diagnostic, never an execution or permission grant. */
export async function orderRecoveryReadiness(tx: Prisma.TransactionClient, run: AmazonSyncRun): Promise<OrderRecoveryReadiness | null> {
  if (run.resource !== "orders" || !["FAILED", "BLOCKED", "PARTIAL_SUCCESS", "PAUSED"].includes(run.status)) return null;
  const base = { checkedAt: new Date().toISOString(), approvalRequired: true as const, started: false as const };
  if (run.stage === "PURGED") return { ...base, state: "BLOCKED", reason: "CHECKPOINT_PURGED", message: "历史检查点已按保留策略清理，不能恢复该任务。", checkpoint: null };
  try {
    const evidence = await inspectOrderRecovery(tx, run);
    const collision = await tx.amazonSyncRun.findFirst({ where: {
      organizationId: run.organizationId, workspaceId: run.workspaceId, sourceId: run.sourceId,
      id: { not: run.id }, status: { in: activeTaskStatuses },
    }, select: { id: true } });
    if (collision) return { ...base, state: "BLOCKED", reason: "ACTIVE_TASK_EXISTS", message: "该数据源已有其他活动任务，请先核对；不能重复恢复。", checkpoint: null };
    const { cursorDigest: _cursorDigest, ...checkpoint } = evidence;
    void _cursorDigest;
    return { ...base, state: "CHECKPOINT_VALID", reason: null, message: "检查点可继续；权限、授权与任务版本仍须在申请和执行时复核。", checkpoint };
  } catch (error) {
    if (!(error instanceof SyncInputError)) throw error;
    return { ...base, state: "BLOCKED", reason: "CHECKPOINT_INVALID", message: "检查点缺失、窗口不匹配或策略不兼容；保留现有数据，请核对任务与游标，不能从头覆盖。", checkpoint: null };
  }
}

/** Bind a retry to its existing cursor and durable work, never to a newer window.
 * Returned evidence contains counters and digests, not tokens, order IDs or PII. */
export async function inspectOrderRecovery(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  if (run.resource !== "orders" || !run.sourceId) throw new SyncInputError("订单恢复任务范围无效。", 409);
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const frozen = run.frozenScope as Prisma.JsonObject | null;
  const window = orderWindowFromFrozen(frozen?.orderWindow);
  const historyReplay = frozen?.orderHistoryReplay === true;
  const policy = parseOrderSyncPolicy(frozen?.orderPolicy);
  const detailPolicyDigest = policy.details ? digest(policy.details) : null;
  const cursor = await tx.amazonSyncResourceCursor.findFirst({ where: { ...scope, sourceId: run.sourceId } });
  if (!cursor && (historyReplay || run.pagesCompleted !== 0 || run.detailsCompletedCount !== 0)) throw new SyncInputError("订单已有提交进度或补采任务但游标缺失，不能从头重试。", 409);
  const unstarted = run.pagesCompleted === 0 && run.detailsCompletedCount === 0;
  const followsCompletedWindow = !historyReplay && cursor?.status === "SUCCEEDED" && cursor.activeRunId !== run.id && unstarted && Date.parse(window.to) > cursor.watermarkTo.getTime();
  const validHistoryReplay = historyReplay && cursor?.status === "SUCCEEDED" && Date.parse(window.to) <= cursor.watermarkTo.getTime()
    && cursor.detailPolicyDigest === detailPolicyDigest && (run.pagesCompleted === 0 || !!run.checkpointCiphertext);
  if (historyReplay && !validHistoryReplay) throw new SyncInputError("订单历史补采检查点或已完成游标无效，不能回退前向水位。", 409);
  if (validHistoryReplay && run.pagesCompleted > 0) {
    const coverage = ((run.summary as Prisma.JsonObject | null)?.coverage ?? {}) as Prisma.JsonObject;
    const cursorDigest = orderCursorDigest(cursor!);
    if (coverage.cursorDigest !== cursorDigest) throw new SyncInputError("订单前向游标已变化；历史补采检查点不能继续。", 409);
  }
  if (cursor && (cursor.resource !== "orders" || (!historyReplay && !followsCompletedWindow && (cursor.activeRunId !== run.id || cursor.status === "SUCCEEDED"))
    || cursor.amazonSellerId !== frozen?.amazonSellerId || cursor.marketplaceId !== frozen?.marketplaceId
    || (!historyReplay && !followsCompletedWindow && (cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to
    || cursor.detailPolicyDigest !== detailPolicyDigest)))) {
    throw new SyncInputError("订单游标已变更、已完成或不属于当前任务窗口；保留现有数据，不能接管后续任务。", 409);
  }
  const workWhere = { ...scope, sourceId: run.sourceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest: detailPolicyDigest ?? "" };
  const pendingDetails = await tx.amazonOrderDetailWork.count({ where: { ...workWhere, status: "PENDING" } });
  const archivedResponses = await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: run.id, resource: "orders", page: { gt: 0 } } });
  return { mode: historyReplay ? "RESUME_COMMITTED_ORDER_HISTORY_REPLAY" : "RESUME_COMMITTED_ORDER_CHECKPOINT", window, pagesCompleted: run.pagesCompleted, detailsCompleted: run.detailsCompletedCount,
    pendingDetails, archivedResponses, listComplete: historyReplay ? run.paginationComplete : !followsCompletedWindow && (cursor?.listComplete ?? false),
    cursorDigest: cursor ? digest({ id: cursor.id, activeRunId: cursor.activeRunId, status: cursor.status, window, nextTokenCiphertext: cursor.nextTokenCiphertext, detailPolicyDigest, listComplete: cursor.listComplete }) : null,
    nextOperation: pendingDetails ? "getOrder" : (historyReplay ? run.paginationComplete : !followsCompletedWindow && cursor?.listComplete) ? "COMPLETE_WINDOW" : "searchOrders", restartsFromBeginning: false };
}

/** Compare current counters with the immutable evidence of the applied recovery.
 * Old approvals without this evidence remain unknown rather than inventing zero. */
export function orderRecoveryOutcome(task: { status: string; pagesCompleted: number; detailsCompletedCount: number }, pendingDetails: number, evidence: unknown, appliedAt: Date | null) {
  if (!appliedAt || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const baseline = evidence as Record<string, unknown>;
  const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (typeof baseline.mode !== "string" || !baseline.mode.startsWith("RESUME_COMMITTED_ORDER_") || !nonnegative(baseline.pagesCompleted) || !nonnegative(baseline.detailsCompleted) || !nonnegative(baseline.pendingDetails)) return null;
  const pagesAdvanced = task.pagesCompleted - baseline.pagesCompleted, detailsAdvanced = task.detailsCompletedCount - baseline.detailsCompleted;
  const state = pagesAdvanced < 0 || detailsAdvanced < 0 ? "COUNTER_MISMATCH"
    : task.status === "SUCCEEDED" ? pendingDetails === 0 ? "WINDOW_COMPLETED" : "INCONSISTENT_PENDING_WORK"
    : ["FAILED", "BLOCKED", "PARTIAL_SUCCESS"].includes(task.status) ? "FAILED_AGAIN"
    : pagesAdvanced || detailsAdvanced ? "ADVANCED" : "AWAITING_PROGRESS";
  return { state, appliedAt: appliedAt.toISOString(), baselinePages: baseline.pagesCompleted, baselineDetails: baseline.detailsCompleted,
    baselinePendingDetails: baseline.pendingDetails, pagesAdvanced, detailsAdvanced, pendingDetails,
    basis: "APPLIED_APPROVAL_AND_CURRENT_WINDOW_WORK", historicalUniverseComplete: false };
}
