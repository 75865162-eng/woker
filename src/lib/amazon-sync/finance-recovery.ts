import type { Prisma } from "@prisma/client";
import { approvedContext } from "./approved-context";
import { assertAmazonScopeAdmin } from "./data-access";
import { digest, targetEnvironment } from "./approval-policy";
import { activeTaskStatuses, SyncInputError, type SyncScope } from "./policy";
import { assertFinanceRequestWindow, parseFinancePolicy, previewFinanceRetentionRecovery } from "./finance";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";

/** Never treat a generic 400 as authority to discard a continuation token. */
export async function previewFinanceReplay(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "finance" }, include: { authorization: true, resourceCursor: true } });
  const cursor = source.resourceCursor;
  if (!cursor || cursor.status !== "FAILED" || !cursor.nextTokenCiphertext || !cursor.activeRunId || !source.authorization.identityVerifiedAt || cursor.amazonSellerId !== source.authorization.amazonSellerId) throw new SyncInputError("财务重放缺少已核验身份或失败分页证据。", 409);
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId, OR: [{ status: { in: activeTaskStatuses } }, { leaseExpiresAt: { gt: new Date() } }] } }) || await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId } } } })) throw new SyncInputError("财务重放前须经审批暂停计划并等待活动任务结束。", 409);
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: cursor.activeRunId, sourceId, status: "FAILED", resource: "finance", executionVersion: 2 } });
  const rejection = await tx.amazonSyncTaskLog.findFirst({ where: { ...scope, taskId: run.id, event: "listTransactions", statusCode: 400, code: "FINANCE_NEXT_TOKEN_REJECTED" }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
  if (!run.startedAt || !rejection || rejection.createdAt < run.startedAt) throw new SyncInputError("未确认分页令牌失效，禁止将其他400当作重放依据。", 409);
  const frozen = run.frozenScope as { financeWindow?: { from?: string; to?: string }; financePolicy?: unknown } | null;
  const window = { from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() };
  assertFinanceRequestWindow(window, new Date());
  if (frozen?.financeWindow?.from !== window.from || frozen?.financeWindow?.to !== window.to || digest(parseFinancePolicy(frozen?.financePolicy)) !== digest(parseFinancePolicy(source.financePolicy))) throw new SyncInputError("财务失败窗口或冻结策略不一致。", 409);
  const token = decryptCheckpoint(cursor.nextTokenCiphertext, scope, cursor.id);
  if (!token || decryptCheckpoint(run.checkpointCiphertext, scope, run.id) !== token) throw new SyncInputError("旧任务未完整保留原分页令牌，禁止重放。", 409);
  const manifest = { sourceId, sourceRevision: source.revision, authorizationRevision: source.authorization.revision, cursorId: cursor.id, cursorUpdatedAt: cursor.updatedAt.toISOString(), captureSequence: cursor.captureSequence, originalTaskId: run.id, taskUpdatedAt: run.updatedAt.toISOString(), rejectedLogId: rejection.id, tokenDigest: digest(cursor.nextTokenCiphertext), window, sameWindow: true, preservedPages: run.pagesCompleted, preservedRows: run.processedCount };
  return { source, cursor, run, manifest, recoveryDigest: digest(manifest) };
}

export async function applyFinanceReplay(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const target = new URL(process.env.DATABASE_URL ?? "invalid:");
  const fixture = process.env.AMAZON_SYNC_OFFLINE_FIXTURE === "1" && target.hostname === "127.0.0.1" && target.pathname === "/amazon_sync_test" && scope.organizationId.startsWith("finance-fixture-") && scope.workspaceId === "finance-test";
  if (!fixture && (targetEnvironment() !== "local" || target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default")) throw new SyncInputError("财务重放仅限已批准独立本机。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-finance-window");
  await assertAmazonScopeAdmin(scope, actor, tx);
  const { source, cursor, manifest, recoveryDigest } = await previewFinanceReplay(tx, scope, String(command.id));
  if (command.revision !== source.revision || command.recoveryDigest !== recoveryDigest) throw new SyncInputError("财务重放证据已变化。", 409);
  const replay = { replayApprovalId: approvalId, originalTaskId: manifest.originalTaskId, window: manifest.window, tokenDigest: manifest.tokenDigest };
  await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { nextTokenCiphertext: null, reportStateCiphertext: encryptCheckpoint(JSON.stringify(replay), scope, cursor.id) } });
  await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { revision: { increment: 1 } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.finance.same_window_replay", entityType: "AmazonSyncDataSource", entityId: source.id, metadata: { workspaceId: scope.workspaceId, approvalId, ...manifest, originalTokenPreservedInTask: true, noTaskStarted: true } } });
  return { sourceId: source.id, revision: source.revision + 1, sameWindow: true, noTaskStarted: true };
}

/** All DB access is scoped. Preview is read-only; apply requires the existing
 * sealed-command approval transaction. No remote API or task is started here. */
export async function previewFinanceRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, reviewedAt: Date) {
  if (!Number.isFinite(reviewedAt.getTime()) || reviewedAt.getTime() > Date.now() || Date.now() - reviewedAt.getTime() > 3600000) throw new SyncInputError("财务恢复预审时间无效或已过期。", 409);
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: sourceId, resource: "finance" }, include: { authorization: true, resourceCursor: true } });
  const cursor = source.resourceCursor;
  if (!cursor || cursor.status === "SUCCEEDED") throw new SyncInputError("没有待恢复的失败财务起始窗口。", 409);
  const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, sourceId }, select: { id: true, status: true, pagesCompleted: true, checkpointCiphertext: true, updatedAt: true, leaseExpiresAt: true }, orderBy: { id: "asc" }, take: 1001 });
  if (runs.length > 1000 || runs.some(run => activeTaskStatuses.includes(run.status) || (run.leaseExpiresAt && run.leaseExpiresAt > new Date()))) throw new SyncInputError("财务恢复前须停止活动任务或缩小审核范围。", 409);
  const runIds = runs.map(run => run.id);
  const pages = await tx.amazonSyncPage.count({ where: { ...scope, taskId: { in: runIds } } });
  const rawPages = await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: { in: runIds } } });
  const records = await tx.amazonFinanceRecord.count({ where: { ...scope, sourceId } });
  const proposal = previewFinanceRetentionRecovery({ from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() }, reviewedAt, { hasNextToken: !!cursor.nextTokenCiphertext, pages: Math.max(pages, rawPages, ...runs.map(run => run.pagesCompleted)), records, hasCheckpoint: !!cursor.reportStateCiphertext || runs.some(run => !!run.checkpointCiphertext) });
  if (!proposal.proposed || !proposal.gap || proposal.blockers.length) throw new SyncInputError("财务窗口已有进度、已全部过期或不需截断；禁止自动重置。", 409);
  const policy = parseFinancePolicy(source.financePolicy);
  if (cursor.captureSequence !== 0 || cursor.lastSuccessAt || source.lastSuccessAt) throw new SyncInputError("财务存在历史提交证据，不能按空起始窗口恢复。", 409);
  if (policy.initialFrom !== cursor.watermarkFrom.toISOString()) throw new SyncInputError("只允许恢复尚未完成首次采集的起始窗口。", 409);
  const evidence = { sourceId, sourceRevision: source.revision, authorizationRevision: source.authorization.revision, amazonSellerId: source.authorization.amazonSellerId, policy, cursor: { id: cursor.id, status: cursor.status, updatedAt: cursor.updatedAt, activeRunId: cursor.activeRunId, captureSequence: cursor.captureSequence }, runs: runs.map(({ checkpointCiphertext, ...run }) => ({ ...run, hasCheckpoint: !!checkpointCiphertext })), proposal };
  return { source, cursor, proposal, recoveryDigest: digest(JSON.parse(JSON.stringify(evidence))) };
}
export async function applyFinanceRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const target = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "55439" || target.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default") throw new SyncInputError("财务恢复仅允许已审阅的独立本机环境。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-finance-window");
  await assertAmazonScopeAdmin(scope, actor, tx);
  const report = await previewFinanceRecovery(tx, scope, String(command.id), new Date(String(command.reviewedAt)));
  const { source, cursor, proposal } = report;
  if (source.revision !== command.revision || report.recoveryDigest !== command.recoveryDigest) throw new SyncInputError("财务恢复清单已变化。", 409);
  if (!source.authorization.amazonSellerId || !source.authorization.identityVerifiedAt || cursor.amazonSellerId !== source.authorization.amazonSellerId) throw new SyncInputError("须先完成真实卖家身份接管。", 409);
  const enabledPlans = await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: source.id } } } });
  if (enabledPlans) throw new SyncInputError("财务恢复前须经审批暂停计划。", 409);
  assertFinanceRequestWindow(proposal.proposed!, new Date());
  const previous = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
  if (previous.retentionGaps !== undefined && !Array.isArray(previous.retentionGaps)) throw new SyncInputError("财务缺口记录格式异常。", 409);
  const gap = { ...proposal.gap!, approvalId, recordedAt: new Date().toISOString(), complete: false };
  const policy = parseFinancePolicy({ ...parseFinancePolicy(source.financePolicy), initialFrom: proposal.proposed!.from });
  const updated = await tx.amazonSyncDataSource.updateMany({ where: { ...scope, id: source.id, revision: source.revision }, data: { financePolicy: policy as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, coverage: { ...previous, retentionGaps: [...(Array.isArray(previous.retentionGaps) ? previous.retentionGaps : []), gap], historicalComplete: false } } });
  if (updated.count !== 1) throw new SyncInputError("财务来源版本已变化。", 409);
  // No committed pages or ciphertext exist (checked above). Retain old run IDs
  // and failure logs; new tasks must freeze the new policy and window.
  await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { watermarkFrom: new Date(proposal.proposed!.from), watermarkTo: new Date(proposal.proposed!.to), detailPolicyDigest: digest(policy) } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.finance.retention_recovered", entityType: "AmazonSyncDataSource", entityId: source.id, metadata: { workspaceId: scope.workspaceId, approvalId, recoveryDigest: report.recoveryDigest, original: proposal.original, proposed: proposal.proposed, gap, oldTasksPreserved: true, noTaskStarted: true } } });
  return { id: source.id, revision: source.revision + 1, gap, noTaskStarted: true };
}
