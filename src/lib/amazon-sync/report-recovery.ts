import { settlementScope } from "./settlement-scope";
import { parseSettlementPolicy } from "./settlements";
import type { Prisma } from '@prisma/client';
import { approvedContext } from './approved-context';
import { digest, targetEnvironment, productionRecoveryUnlocked } from './approval-policy';
import { decryptCheckpoint, encryptCheckpoint } from './checkpoint';
import { AmazonSpApiClient } from '@/lib/amazon/sp-api-client';
import { decryptAmazonSpApiCredentials } from '@/lib/amazon/integration-secrets';
import { domainReportTypes, reimbursementRunWindow, domainReportRunWindow, assertSettlementDiscoveryAvailable } from './domain-reports';
import { activeTaskStatuses, SyncInputError, type SyncScope } from './policy';

export async function previewReportRecovery(tx: Prisma.TransactionClient, scope: SyncScope, id: string, window?: unknown, settlementPolicy?: unknown, abandonBrokenCheckpoint = false) {
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id }, include: { resourceCursor: true, authorization: true } });
  if (!['reimbursements', 'inventory_age', 'inventory_events', 'settlements'].includes(source.resource)) throw new SyncInputError('不支持此报告恢复。');
  const cursor = source.resourceCursor;
  // A ledger request cancelled during creation leaves a checkpoint with no
  // reportId/documentId and no submitted evidence. It cannot be reconciled;
  // an explicit approved abandonment drops only that empty cursor so the same
  // source can be re-run with a fresh, valid window. No facts/documents exist.
  if (abandonBrokenCheckpoint) {
    if (source.resource !== 'inventory_events') throw new SyncInputError('仅库存事件支持废弃损坏检查点。', 409);
    if (!cursor) throw new SyncInputError('没有可废弃的检查点。', 409);
    if (source.lastSuccessAt || cursor.lastSuccessAt) throw new SyncInputError('已有成功水位，不能废弃检查点。', 409);
    if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } })) throw new SyncInputError('报告仍有活动任务。', 409);
    if (await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })) throw new SyncInputError('废弃前须暂停对应计划。', 409);
    const state = cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? '{}') : {};
    if (state.reportId || state.documentId || state.archiveTaskId || state.offset || state.rows) throw new SyncInputError('检查点含报告或进度证据，不能废弃；须单独核查。', 409);
    const rawCount = await tx.amazonSyncRawPage.count({ where: { ...scope, task: { sourceId: id } } });
    const docCount = await tx.amazonSyncReportDocument.count({ where: { ...scope, sourceId: id } });
    const rowCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: id } });
    if (rawCount || docCount || rowCount) throw new SyncInputError('已存在原件或数据行，不能废弃检查点。', 409);
    return { source, cursor, run: null as never, proposed: null, partialProgress: null,
      abandon: { cursorDigest: digest(cursor.reportStateCiphertext), marketplaceId: source.marketplaceId },
      recoveryDigest: digest(JSON.parse(JSON.stringify({ mode: 'abandon-broken-checkpoint', sourceId: id, revision: source.revision, cursorId: cursor.id, status: cursor.status, cursorDigest: digest(cursor.reportStateCiphertext), watermarkFrom: cursor.watermarkFrom.toISOString(), watermarkTo: cursor.watermarkTo.toISOString() }))) };
  }
  if (!cursor?.activeRunId || source.lastSuccessAt || cursor.lastSuccessAt) throw new SyncInputError('报告不符合首次失败恢复范围。', 409);
  const run = await tx.amazonSyncRun.findFirstOrThrow({ where: { ...scope, id: cursor.activeRunId, sourceId: id } });
  if (!['FAILED', 'BLOCKED'].includes(run.status) || cursor.nextTokenCiphertext) throw new SyncInputError('报告仍在运行或分页状态不符，禁止恢复。', 409);
  if (await tx.amazonSyncRun.count({ where: { ...scope, sourceId: id, status: { in: activeTaskStatuses } } })) throw new SyncInputError('报告仍有活动任务。', 409);
  let partialProgress: Record<string, unknown> | null = null;
  const rawCount = await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: run.id } });
  if (['reimbursements', 'inventory_age'].includes(source.resource) && (run.pagesCompleted || run.processedCount || rawCount)) throw new SyncInputError('原报告已有进度，须另行核查。', 409);
  if (source.resource === 'inventory_events' && (run.pagesCompleted || run.processedCount || rawCount)) {
    if (!cursor.reportStateCiphertext) throw new SyncInputError('原库存事件报告缺少可续跑的密文游标。', 409);
    const state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? '{}');
    const archive = typeof state.archiveTaskId === 'string' && Number.isSafeInteger(state.archivePage) ? await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: state.archivePage as number, resource: source.resource } }) : null;
    const document = typeof state.reportId === 'string' ? await tx.amazonSyncReportDocument.findFirst({ where: { ...scope, sourceId: id, reportId: state.reportId, resource: source.resource } }) : null;
    const persistedRows = document ? await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: id, reportDocumentId: document.id } }) : 0;
    if (state.archiveTaskId !== run.id || !archive || !document || document.status !== 'STAGED' || document.rowCount !== state.rows || !state.documentSaved || state.offset !== run.processedCount || persistedRows !== run.insertedCount || run.processedCount !== run.insertedCount + run.skippedCount || rawCount !== 1 || run.checkpointCiphertext !== cursor.reportStateCiphertext || run.pagesCompleted !== 1 + Math.ceil(run.processedCount / 500)) throw new SyncInputError('原库存事件文档、已提交批次和密文游标不能精确对齐，保留原任务等待人工核查。', 409);
    partialProgress = { rawCount, archivePage: archive.page, bodySha256: archive.bodySha256, reportDocumentId: document.id, documentStatus: document.status, rowCount: document.rowCount, persistedRows, offset: state.offset, pagesCompleted: run.pagesCompleted, processedCount: run.processedCount, insertedCount: run.insertedCount, skippedCount: run.skippedCount };
  }
  if (await tx.amazonSyncSchedule.count({ where: { ...scope, enabled: true, targets: { some: { sourceId: id } } } })) throw new SyncInputError('恢复前须暂停对应计划。', 409);
  if (source.resource === 'settlements') {
    const prior = cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? '{}') : {};
    if (Object.keys(prior).length || run.checkpointCiphertext) throw new SyncInputError('结算已有发现或报告进度，不允许空窗口恢复。', 409);
    const rawCount = await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: run.id } });
    if (rawCount) throw new SyncInputError('原结算已有加密页，须另行核查。', 409);
    const proposed = domainReportRunWindow('settlements', window)!;
    if (!('createdSince' in proposed)) throw new SyncInputError('结算发现窗口无效。');
    assertSettlementDiscoveryAvailable(proposed, new Date());
    const policy = parseSettlementPolicy(settlementPolicy);
    const collection = await settlementScope(tx, scope, { authorizationId: source.authorizationId, marketplaceId: source.marketplaceId, settlementPolicy: policy }, []);
    return { source, cursor, run, proposed: null, settlement: { window: proposed, ...collection }, recoveryDigest: digest(JSON.parse(JSON.stringify({ sourceId: id, revision: source.revision, authorizationRevision: source.authorization.revision, cursor, run: { id: run.id, status: run.status, updatedAt: run.updatedAt, checkpoint: run.checkpointCiphertext }, proposed, collection }))) };
  }
  const proposed = source.resource === 'reimbursements' ? reimbursementRunWindow(window) : null;
  if (source.resource === 'inventory_events') {
    if (!cursor.reportStateCiphertext) throw new SyncInputError('原库存事件报告没有可续跑的密文游标。', 409);
    const state = JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? '{}');
    const invalid = [typeof state.reportId !== 'string' ? 'REPORT_ID_MISSING' : '', typeof state.documentId !== 'string' ? 'DOCUMENT_ID_MISSING' : '', partialProgress === null && (state.archiveTaskId || state.offset || state.rows) ? 'UNRECONCILED_PROGRESS' : '', partialProgress && state.archiveTaskId !== run.id ? 'ARCHIVE_TASK_MISMATCH' : ''].filter(Boolean);
    if (invalid.length) throw new SyncInputError(`库存事件报告检查点无法恢复：${invalid.join(',')}`, 409);
  }
  if (source.resource === 'inventory_age' && source.marketplaceId !== 'A1AM78C64UM0Y8') throw new SyncInputError('取消快照恢复仅限已批准墨西哥。', 403);
  return { source, cursor, run, proposed, partialProgress, recoveryDigest: digest(JSON.parse(JSON.stringify({ sourceId: id, revision: source.revision, authorizationRevision: source.authorization.revision, cursor, run: { id: run.id, status: run.status, updatedAt: run.updatedAt, checkpoint: run.checkpointCiphertext, pagesCompleted: run.pagesCompleted, processedCount: run.processedCount, insertedCount: run.insertedCount, skippedCount: run.skippedCount }, partialProgress, proposed }))) };
}
export async function applyReportRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (!productionRecoveryUnlocked(scope) && (targetEnvironment() !== 'local' || url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/amazon_sync_live_local' || scope.organizationId !== 'amazon-live-local' || scope.workspaceId !== 'default')) throw new SyncInputError('仅限已批准本地环境。', 403);
  const abandonBrokenCheckpoint = command.abandonBrokenCheckpoint === true;
  const { tx, approvalId } = approvedContext(scope, 'recover-report');
  const p = await previewReportRecovery(tx, scope, String(command.id), command.reportWindow, command.settlementPolicy, abandonBrokenCheckpoint);
  if (p.source.revision !== command.revision || p.recoveryDigest !== command.recoveryDigest) throw new SyncInputError('报告恢复清单已变化。', 409);
  if ('abandon' in p && p.abandon) {
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: 'amazon.sync.report.broken-checkpoint-abandoned', entityType: 'AmazonSyncDataSource', entityId: p.source.id, metadata: JSON.parse(JSON.stringify({ workspaceId: scope.workspaceId, approvalId, resource: p.source.resource, marketplaceId: p.abandon.marketplaceId, originalCursorId: p.cursor.id, originalStatus: p.cursor.status, originalCursorDigest: p.abandon.cursorDigest, originalWatermarkFrom: p.cursor.watermarkFrom.toISOString(), originalWatermarkTo: p.cursor.watermarkTo.toISOString(), historicalComplete: false })) } });
    await tx.amazonSyncResourceCursor.delete({ where: { id: p.cursor.id } });
    await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { revision: { increment: 1 } } });
    return { id: p.source.id, brokenCheckpointAbandoned: true, noTaskStarted: true };
  }
  if ('settlement' in p && p.settlement) {
    const collection = await settlementScope(tx, scope, { authorizationId: p.source.authorizationId, marketplaceId: p.source.marketplaceId, settlementPolicy: p.settlement.policy }, [actor]);
    if (digest(collection) !== digest({ policy: p.settlement.policy, bindings: p.settlement.bindings })) throw new SyncInputError('结算绑定已变化。', 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: 'amazon.sync.settlement.recovered', entityType: 'AmazonSyncDataSource', entityId: p.source.id, metadata: JSON.parse(JSON.stringify({ workspaceId: scope.workspaceId, approvalId, originalCursor: p.cursor, originalRunId: p.run.id, proposed: p.settlement, historicalComplete: false })) } });
    await tx.amazonSyncResourceCursor.update({ where: { sourceId: p.source.id }, data: { watermarkFrom: new Date(p.settlement.window.createdSince), watermarkTo: new Date(p.settlement.window.createdUntil) } });
    await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { settlementPolicy: p.settlement.policy, revision: { increment: 1 } } });
    return { id: p.source.id, oldTaskPreserved: true, originalCursorAudited: true, noTaskStarted: true };
  }
  const state = JSON.parse(decryptCheckpoint(p.cursor.reportStateCiphertext, scope, p.cursor.id) ?? '{}');
  if (typeof state.reportId !== 'string' || p.source.resource === 'inventory_events' && (typeof state.documentId !== 'string' || (p.partialProgress ? state.archiveTaskId !== p.run.id : !!(state.archiveTaskId || state.offset || state.rows))) || p.source.resource !== 'inventory_events' && (p.partialProgress || state.archiveTaskId || state.offset || state.rows || state.documentId)) throw new SyncInputError('原报告缺少可核验终态或已有文档进度。', 409);
  const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(p.source.authorization.credentialsCiphertext, { ...scope, authorizationId: p.source.authorizationId }), region: p.source.authorization.awsRegion, endpoint: p.source.authorization.endpoint });
  const remote = await client.getReport(state.reportId) as { reportId?: string; reportType?: string; marketplaceIds?: string[]; processingStatus?: string; reportDocumentId?: string };
  // A reimbursement report may legitimately end as FATAL or CANCELLED upstream
  // (no document). Either terminal state proves the original request finished
  // without a document, so the approved recovery may reset the cursor to
  // re-create the same frozen window. Never accept DONE here: a DONE report has
  // a document that must be reconciled, not discarded.
  const acceptableStatuses: string[] = p.source.resource === 'reimbursements' ? ['FATAL', 'CANCELLED']
    : p.source.resource === 'inventory_age' ? ['CANCELLED'] : ['DONE'];
  if (remote.reportId !== state.reportId || remote.reportType !== domainReportTypes[p.source.resource as 'reimbursements' | 'inventory_age' | 'inventory_events'] || !acceptableStatuses.includes(String(remote.processingStatus)) || (acceptableStatuses.includes('DONE') ? remote.reportDocumentId !== state.documentId : !!remote.reportDocumentId) || !Array.isArray(remote.marketplaceIds) || remote.marketplaceIds.length !== 1 || remote.marketplaceIds[0] !== p.source.marketplaceId) throw new SyncInputError('远端报告终态、站点或类型不符合批准范围。', 409);
  if (p.source.resource === 'inventory_events') {
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: 'amazon.sync.report.reconciled', entityType: 'AmazonSyncDataSource', entityId: p.source.id, metadata: JSON.parse(JSON.stringify({ workspaceId: scope.workspaceId, approvalId, resource: p.source.resource, marketplaceId: p.source.marketplaceId, runId: p.run.id, cursorId: p.cursor.id, cursorDigest: digest(p.cursor.reportStateCiphertext), checkpointDigest: digest(p.run.checkpointCiphertext), reportIdDigest: digest(state.reportId), reportType: remote.reportType, remoteTerminalStatus: remote.processingStatus, documentIdDigest: digest(state.documentId), partialProgress: p.partialProgress, remoteVerifiedAt: new Date().toISOString(), cursorPreserved: true, taskPreserved: true })) } });
    await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { revision: { increment: 1 } } });
    return { id: p.source.id, oldTaskPreserved: true, oldCursorPreserved: true, noTaskStarted: true };
  }
  const replacement = encryptCheckpoint(JSON.stringify({ polls: 0, recoveryApprovalId: approvalId }), scope, p.cursor.id);
  // Original cursor and checkpoint are retained as encrypted audit evidence;
  // no old task, raw document, fact or success watermark is deleted.
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: 'amazon.sync.report.recovered', entityType: 'AmazonSyncDataSource', entityId: p.source.id, metadata: JSON.parse(JSON.stringify({ workspaceId: scope.workspaceId, approvalId, originalCursor: p.cursor, originalRunId: p.run.id, originalCheckpointDigest: digest(p.run.checkpointCiphertext), replacementStateDigest: digest(replacement), remoteTerminalStatus: remote.processingStatus, remoteReportDigest: digest(state.reportId), remoteVerifiedAt: new Date().toISOString(), proposed: p.proposed, historicalComplete: false })) } });
  await tx.amazonSyncResourceCursor.update({ where: { sourceId: p.source.id }, data: { status: 'FAILED', reportStateCiphertext: replacement, ...(p.proposed ? { watermarkFrom: new Date(p.proposed.dataStartTime), watermarkTo: new Date(p.proposed.dataEndTime) } : {}) } });
  await tx.amazonSyncDataSource.update({ where: { id: p.source.id }, data: { revision: { increment: 1 } } });
  return { id: p.source.id, oldTaskPreserved: true, oldCursorArchived: true, noTaskStarted: true };
}
