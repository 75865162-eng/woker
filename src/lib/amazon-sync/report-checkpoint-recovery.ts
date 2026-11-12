import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { digest } from "./approval-policy";
import { decryptCheckpoint } from "./checkpoint";
import { domainReportTypes, domainReportHistoryCursorDigest, inventoryEventRunWindow, reimbursementRunWindow } from "./domain-reports";
import { SyncInputError } from "./policy";

/** Preview and apply bind to the same durable report identity and progress. */
export async function inspectReportRecovery(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const reject = (): never => { throw new SyncInputError("报告恢复范围、检查点或原件身份已变化；保留已有数据，请重新核对。", 409); };
  if (!["reimbursements", "inventory_events"].includes(run.resource) || !run.sourceId
    || !["FAILED", "BLOCKED", "PARTIAL_SUCCESS", "PAUSED"].includes(run.status)
    || ["PURGED", "BINDING_DISABLED"].includes(run.stage) || run.control || run.leaseOwner || run.leaseExpiresAt) return reject();
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: run.sourceId }, include: { authorization: true, resourceCursor: true } });
  const frozen = run.frozenScope as Prisma.JsonObject | null;
  if (!source || !source.enabled || source.resource !== run.resource || source.authorization.status !== "CONFIGURED" || !frozen
    || digest(frozen) !== run.frozenScopeDigest || frozen.sourceRevision !== source.revision
    || frozen.authorizationId !== source.authorizationId || frozen.authorizationRevision !== source.authorization.revision
    || frozen.sellerAccountId !== source.sellerAccountId || frozen.marketplaceId !== source.marketplaceId
    || frozen.amazonSellerId !== source.authorization.amazonSellerId) return reject();
  const cursor = source.resourceCursor;
  const historyReplay = run.resource === "reimbursements" && frozen.reimbursementHistoryReplay === true
    || run.resource === "inventory_events" && frozen.inventoryEventHistoryReplay === true;
  if (historyReplay && !cursor) return reject();
  if (!cursor) {
    if (run.checkpointCiphertext || run.pagesCompleted || run.processedCount || run.insertedCount || run.updatedCount || run.skippedCount
      || await tx.amazonSyncRawPage.count({ where: { ...scope, taskId: run.id } })) return reject();
    return { mode: "RESUME_FROZEN_REPORT_REQUEST", frozenDigest: run.frozenScopeDigest, checkpointDigest: digest(null),
      initialReportRequestPending: true, archivedDocumentReused: false };
  }
  const window = run.resource === "inventory_events" ? inventoryEventRunWindow(frozen.reportWindow) : reimbursementRunWindow(frozen.reportWindow);
  if (historyReplay) {
    const expectedCursorDigest = run.resource === "reimbursements" ? frozen.reimbursementHistoryCursorDigest : frozen.inventoryEventHistoryCursorDigest;
    if (cursor.status !== "SUCCEEDED" || expectedCursorDigest !== domainReportHistoryCursorDigest(cursor)
      || Date.parse(window.dataEndTime) > cursor.watermarkTo.getTime()) return reject();
  } else if (cursor.activeRunId !== run.id || cursor.reportStateCiphertext !== run.checkpointCiphertext
    || cursor.watermarkFrom.getTime() !== Date.parse(window.dataStartTime) || cursor.watermarkTo.getTime() !== Date.parse(window.dataEndTime)) return reject();
  if (cursor.resource !== run.resource || cursor.organizationId !== scope.organizationId || cursor.workspaceId !== scope.workspaceId
    || cursor.amazonSellerId !== source.authorization.amazonSellerId || cursor.marketplaceId !== source.marketplaceId) return reject();
  const decoded = decryptCheckpoint(run.checkpointCiphertext, scope, historyReplay ? run.id : cursor.id);
  const state: Record<string, unknown> = decoded ? JSON.parse(decoded) : {};
  if (!state || typeof state !== "object" || Array.isArray(state)) return reject();
  const offset = state.offset ?? 0;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || (Number(offset) > 0 && !state.archiveTaskId)) return reject();
  let archive: { taskId: string; page: number; bodySha256: string } | null = null;
  if (state.archiveTaskId !== undefined) {
    if (typeof state.archiveTaskId !== "string" || !Number.isSafeInteger(state.archivePage) || Number(state.archivePage) < 1) return reject();
    const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: Number(state.archivePage), resource: run.resource, task: { sourceId: source.id } } });
    const metadata = raw?.requestMetadata as Prisma.JsonObject | null;
    if (!raw || !metadata || !state.reportId || !state.documentId || metadata.reportId !== state.reportId
      || metadata.documentId !== state.documentId || metadata.reportType !== domainReportTypes[run.resource as "reimbursements" | "inventory_events"]
      || metadata.marketplaceId !== source.marketplaceId) return reject();
    archive = { taskId: raw.taskId, page: raw.page, bodySha256: raw.bodySha256 };
  }
  return { mode: "RESUME_ORIGINAL_REPORT_CHECKPOINT", checkpointDigest: digest(run.checkpointCiphertext), frozenDigest: run.frozenScopeDigest,
    cursorDigest: historyReplay ? domainReportHistoryCursorDigest(cursor) : digest({ id: cursor.id, status: cursor.status, from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString(), activeRunId: cursor.activeRunId }),
    archive, offset, pagesCompleted: run.pagesCompleted, processedCount: run.processedCount, insertedCount: run.insertedCount,
    updatedCount: run.updatedCount, skippedCount: run.skippedCount, restartsFromBeginning: false, archivedDocumentReused: !!archive };
}
