import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { approvedContext } from "./approved-context";
import { digest, targetEnvironment, unseal } from "./approval-policy";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { domainReportTypes, parseDomainReport, reimbursementRunWindow } from "./domain-reports";
import { activeTaskStatuses, SyncInputError, type SyncScope } from "./policy";

/** Explicit recovery only: a failed request can reuse an authenticated original
 * from the exact same scope and window. No Amazon request or publication here. */
export async function previewReportArchiveRecovery(tx: Prisma.TransactionClient, scope: SyncScope, id: string, taskId: string, documentId: string) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id, resource: "reimbursements" }, include: { authorization: true, resourceCursor: true } });
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: taskId, sourceId: id, resource: source.resource, executionVersion: 2 } });
  const cursor = source.resourceCursor;
  const frozen = run.frozenScope as Prisma.JsonObject;
  if (!cursor || cursor.activeRunId !== run.id || cursor.status !== "FAILED" || cursor.nextTokenCiphertext || run.status !== "FAILED" || run.leaseOwner || run.leaseExpiresAt
    || run.pagesCompleted || run.processedCount || run.insertedCount || run.updatedCount || run.skippedCount
    || frozen.sourceRevision !== source.revision || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision
    || frozen.sellerAccountId !== source.sellerAccountId || frozen.marketplaceId !== source.marketplaceId || frozen.amazonSellerId !== source.authorization.amazonSellerId)
    throw new SyncInputError("仅可恢复同版本且未提交数据的失败赔偿任务。", 409);
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } })
    || await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })
    || await tx.amazonSyncRawPage.count({ where: { ...scope, taskId } })) throw new SyncInputError("原件恢复前须暂停来源计划，且不能存在活动任务或新任务原件。", 409);
  const window = reimbursementRunWindow(frozen.reportWindow);
  if (cursor.watermarkFrom.getTime() !== Date.parse(window.dataStartTime) || cursor.watermarkTo.getTime() !== Date.parse(window.dataEndTime)) throw new SyncInputError("失败游标与批准日期窗口不一致。", 409);
  const document = await tx.amazonSyncReportDocument.findFirstOrThrow({ where: { ...scope, id: documentId, sourceId: id, resource: source.resource, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonSellerId: source.authorization.amazonSellerId, reportType: domainReportTypes.reimbursements }, include: { task: true } });
  const owner = document.task.frozenScope as Prisma.JsonObject;
  if (document.sourceRunId === taskId || document.task.status !== "SUCCEEDED" || !document.task.paginationComplete || document.task.stage === "PURGED"
    || owner.authorizationId !== source.authorizationId || owner.authorizationRevision !== source.authorization.revision || owner.sourceRevision !== source.revision
    || owner.sellerAccountId !== source.sellerAccountId || owner.marketplaceId !== source.marketplaceId || owner.amazonSellerId !== source.authorization.amazonSellerId
    || digest(reimbursementRunWindow(owner.reportWindow)) !== digest(window)) throw new SyncInputError("历史报告身份、版本或日期窗口不一致，不能替代失败报告。", 409);
  const raw = await tx.amazonSyncRawPage.findFirstOrThrow({ where: { ...scope, taskId: document.sourceRunId, resource: source.resource, bodySha256: document.contentSha256 } });
  const metadata = raw.requestMetadata as Prisma.JsonObject;
  if (metadata.reportId !== document.reportId || metadata.reportType !== document.reportType || metadata.marketplaceId !== source.marketplaceId || metadata.operation !== "getReportDocument" || metadata.apiVersion !== "2021-06-30" || typeof metadata.documentId !== "string") throw new SyncInputError("历史报告原件身份不一致。", 409);
  const original = unseal(raw.rawCiphertext, scope, `${raw.taskId}:${raw.page}`, "amazon-reimbursements-raw.v1");
  if (typeof original.rawText !== "string" || Buffer.byteLength(original.rawText) > 32 * 1024 * 1024 || createHash("sha256").update(original.rawText).digest("hex") !== document.contentSha256) throw new SyncInputError("历史报告原件摘要或容量不符合恢复要求。", 409);
  const parsed = parseDomainReport("reimbursements", original.rawText, { reimbursementWindow: window });
  if (parsed.rowCount !== document.rowCount) throw new SyncInputError("历史报告行数与原件不一致。", 409);
  const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: id, reportDocumentId: document.id }, select: { rowNumber: true, rowHash: true } });
  const hashes = new Map(stored.map(row => [row.rowNumber, row.rowHash]));
  if (stored.length !== parsed.rowCount || parsed.rows.some(row => hashes.get(row.rowNumber) !== row.rowHash)) throw new SyncInputError("历史结构化行与原件摘要不一致，不能复用。", 409);
  const oldState = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}");
  if (typeof oldState.reportId !== "string" || oldState.documentId || oldState.archiveTaskId || oldState.offset) throw new SyncInputError("失败报告已有文档进度，不能替换身份。", 409);
  const manifest = { sourceId: id, taskId, sourceRevision: source.revision, authorizationRevision: source.authorization.revision,
    originalCursorDigest: digest(cursor.reportStateCiphertext), originalCheckpointDigest: digest(run.checkpointCiphertext),
    failedReportId: oldState.reportId, reusedReportId: document.reportId, documentId, rawTaskId: raw.taskId, rawPage: raw.page, rawSha256: raw.bodySha256,
    window, rows: parsed.rowCount, documentStatus: document.status, amazonRequests: 0, published: false };
  return { source, run, cursor, metadata, document, raw, manifest, recoveryDigest: digest(manifest) };
}

export async function applyReportArchiveRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (targetEnvironment() !== "local" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/amazon_sync_live_local" || scope.organizationId !== "amazon-live-local" || scope.workspaceId !== "default") throw new SyncInputError("仅限已批准本地数据环境。", 403);
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const p = await previewReportArchiveRecovery(tx, scope, String(command.id), String(command.taskId), String(command.reportDocumentId));
  if (command.revision !== p.source.revision || command.recoveryDigest !== p.recoveryDigest) throw new SyncInputError("历史原件恢复清单已变化。", 409);
  const cipher = encryptCheckpoint(JSON.stringify({ reportId: p.document.reportId, documentId: p.metadata.documentId,
    archiveTaskId: p.raw.taskId, archivePage: p.raw.page, offset: 0, polls: 0, reportCreatedAt: p.document.reportCreatedAt?.toISOString() ?? null }), scope, p.cursor.id);
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.report.archive-reused", entityType: "AmazonSyncRun", entityId: p.run.id,
    metadata: JSON.parse(JSON.stringify({ workspaceId: scope.workspaceId, approvalId, manifest: p.manifest, originalCursor: p.cursor, originalCheckpoint: p.run.checkpointCiphertext, oldReportPreserved: true, taskStarted: false })) } });
  await tx.amazonSyncResourceCursor.update({ where: { sourceId: p.source.id }, data: { reportStateCiphertext: cipher } });
  await tx.amazonSyncRun.update({ where: { id: p.run.id }, data: { checkpointCiphertext: cipher } });
  return { id: p.source.id, taskId: p.run.id, reusedRows: p.document.rowCount, amazonRequests: 0, taskStarted: false, published: false };
}
