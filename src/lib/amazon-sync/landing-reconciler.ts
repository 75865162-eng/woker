/**
 * 落地页数据补采编排器（Landing Reconciler）。
 *
 * 与 landing-data-assurance 配套：扫描出"有源但未发布"的数据源后，
 * 通过既有受控变更审批链触发一次 run（与网页 owner 手动点击完全同构：
 * requestChange → decideChange(APPROVED) → applyChange），回到 worker 自动
 * 采集/发布。全程不造数、不绕过审批、不修改策略、不接触凭证。
 *
 * 触发后不在此进程长轮询（worker 是独立进程，run 可能耗时数分钟到数小时）；
 * 提供 pollUntilPublished 供调度器下一次 tick 复验，避免长连接与重复触发。
 */
import { prisma } from "@/lib/db/prisma";
import { requestChange, decideChange, applyChange } from "./change-approval";
import { type SyncScope } from "./policy";

export type ReconcileTriggerResult = {
  sourceId: string;
  resource: string;
  status: "TRIGGERED" | "SKIPPED" | "FAILED";
  changeRequestId?: string;
  detail: string;
};

/** 查询数据源 resource（用于日志/报告）。 */
async function sourceInfo(scope: SyncScope, sourceId: string) {
  return prisma.amazonSyncDataSource.findFirst({
    where: { ...scope, id: sourceId },
    select: { id: true, resource: true, enabled: true, activeRunId: true, sellerAccountId: true, marketplaceId: true },
  });
}

/** 是否已存在针对该源的活动任务（防重复触发）。 */
async function hasActiveRun(scope: SyncScope, sourceId: string): Promise<boolean> {
  const count = await prisma.amazonSyncRun.count({
    where: { ...scope, sourceId, status: { in: ["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"] } },
  });
  return count > 0;
}

/**
 * 触发一次受控重采（owner 自动批准，与网页操作同构）。
 * 幂等：已有活动任务时跳过；已有已发布版本时跳过（由调用方保证只传入未发布源）。
 */
export async function triggerReconcile(
  scope: SyncScope,
  actor: string,
  sourceId: string,
): Promise<ReconcileTriggerResult> {
  const source = await sourceInfo(scope, sourceId);
  if (!source) return { sourceId, resource: "<unknown>", status: "FAILED", detail: "数据源不存在。" };
  if (!source.enabled) return { sourceId, resource: source.resource, status: "SKIPPED", detail: "数据源已禁用，跳过（需先启用）。" };
  if (source.activeRunId) return { sourceId, resource: source.resource, status: "SKIPPED", detail: "已有已发布版本，跳过。" };
  if (await hasActiveRun(scope, sourceId)) return { sourceId, resource: source.resource, status: "SKIPPED", detail: "已有活动任务在队列/执行中，跳过以避免重复触发。" };

  try {
    // 1. 提交同步申请（owner 身份，run 操作）
    const change = await requestChange(scope, actor, { action: "run", sourceIds: [sourceId] });
    // 2. 自动批准（网页 POST 中 owner 具备 approve 权限时的同构步骤）
    await decideChange(scope, actor, String(change.id), "APPROVED", "落地页数据保障框架自动补采");
    // 3. 应用（进入 worker 队列）
    await applyChange(scope, actor, String(change.id));
    return { sourceId, resource: source.resource, status: "TRIGGERED", changeRequestId: String(change.id), detail: "已提交并重采，等待 worker 发布。" };
  } catch (error) {
    return { sourceId, resource: source.resource, status: "FAILED", detail: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

/** 批量补采；按 sourceId 去重、逐个独立处理（单个失败不影响其它）。 */
export async function reconcileSources(
  scope: SyncScope,
  actor: string,
  sourceIds: string[],
): Promise<ReconcileTriggerResult[]> {
  const results: ReconcileTriggerResult[] = [];
  for (const sourceId of [...new Set(sourceIds)]) {
    results.push(await triggerReconcile(scope, actor, sourceId));
  }
  return results;
}

/**
 * 复验：给定 sourceId 列表，返回其中已经出现 activeRunId 的源（=已发布，worker 完成）。
 * 供调度器每次 tick 调用，幂等、无副作用。
 */
export async function publishedSince(scope: SyncScope, sourceIds: string[]): Promise<Array<{ sourceId: string; activeRunId: string; resource: string }>> {
  if (!sourceIds.length) return [];
  const rows = await prisma.amazonSyncDataSource.findMany({
    where: { ...scope, id: { in: [...new Set(sourceIds)] }, activeRunId: { not: null } },
    select: { id: true, activeRunId: true, resource: true },
  });
  return rows.map(r => ({ sourceId: r.id, activeRunId: r.activeRunId!, resource: r.resource }));
}

export function formatReconcileResults(results: ReconcileTriggerResult[]): string {
  const lines = ["# 补采触发结果", "", "| 数据源 | 资源 | 状态 | 说明 |", "| --- | --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.sourceId} | ${r.resource} | ${r.status} | ${r.detail} |`);
  const triggered = results.filter(r => r.status === "TRIGGERED").length;
  lines.push("", `已触发 ${triggered} 个重采任务（worker 自动发布后再次扫描即可验收）。`);
  return lines.join("\n");
}
