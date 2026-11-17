import { recordSettlementFieldPersistence } from "./field-persistence-evidence";
import { registerArchivedFields } from "./field-registry";
import { recordReportQualityIssue } from "./quality-issues";
import { rawReportEnvelope } from "./raw-fields";
import { assertSettlementMarketplaces, parseSettlementReport, type SettlementPolicy, type SettlementBinding } from "./settlements";
import { localSellerEvidenceEnabled } from "./seller-report-evidence";
import { decodeReportParts } from "../amazon/report-download-range";
import { readSettlementParts, storeSettlementPart, validateSettlementPartsState, settlementRangeEnabled, type SettlementPartsState } from "./settlement-download-parts";
import { domainReportRunWindow, domainReportTypes } from "./domain-reports";
import { createHash } from "node:crypto";
import { Prisma, type AmazonSyncRun, type AmazonSyncResourceCursor } from "@prisma/client";
import { AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { encryptCheckpoint } from "./checkpoint";
import { SyncInputError, type SyncScope } from "./policy";
import { digest, seal, unseal } from "./approval-policy";
import type { SyncProcessorRuntime, SyncProcessorSource } from './processor-runtime';
import type { DomainReportState } from './domain-report-state';

type SettlementSliceContext = {
  run: AmazonSyncRun; client: AmazonSpApiClient; events: AmazonRequestEvent[];
  now: () => Date; scope: SyncScope; source: SyncProcessorSource;
  state: DomainReportState; documentId: string; cursor: AmazonSyncResourceCursor;
  settlement: { policy: SettlementPolicy; bindings: SettlementBinding[] };
  discoveryWindow: Extract<NonNullable<ReturnType<typeof domainReportRunWindow>>, { createdSince: string }> | null;
  budgetKey: SyncScope & { authorizationId: string; operation: string };
  budget: { nextRequestAt: Date } | null;
  record: (error?: unknown) => Promise<void>;
  saveState: (stage: string, status?: 'WAITING' | 'SUCCEEDED', nextAttemptAt?: Date) => Promise<void>;
};

export function createSettlementProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "scopeLock" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistRequests">) {
  const { prisma, scopeLock, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests } = runtime;
  return async function executeSettlementSlice(context: SettlementSliceContext) {
    const { run, client, events, now, scope, source, state, documentId, cursor, settlement, discoveryWindow, budgetKey, budget, record, saveState } = context;
    const resource = 'settlements';
    const marketplaceIds = assertSettlementMarketplaces(state.marketplaceIds, settlement.policy, source.marketplaceId);
    const reportKey = { ...scope, amazonSellerId: source.authorization.amazonSellerId, region: source.authorization.awsRegion, reportType: domainReportTypes.settlements, reportId: state.reportId! };
    const reportId = digest(reportKey);
    // Reserve a single seller/report owner before any document download. The
    // organization lock and run fence cover both the claim and every commit.
    const claimed = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return null;
      let report = await tx.amazonSettlementReport.findUnique({ where: { organizationId_workspaceId_amazonSellerId_region_reportType_reportId: reportKey } });
      if (!report) report = await tx.amazonSettlementReport.create({ data: { id: reportId, ...reportKey, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision, sourceRunId: run.id, reportMarketplaceIds: marketplaceIds, collectionMarketplaceIds: settlement.policy.collectionMarketplaceIds, siteBindings: settlement.bindings, createdTime: state.reportCreatedAt ? new Date(state.reportCreatedAt) : null } });
      if (report.authorizationId !== source.authorizationId || report.authorizationRevision !== source.authorization.revision || digest(report.reportMarketplaceIds) !== digest(marketplaceIds) || digest(report.collectionMarketplaceIds) !== digest(settlement.policy.collectionMarketplaceIds) || digest(report.siteBindings) !== digest(settlement.bindings)) throw new SyncInputError("结算原件已由不同授权版本或采集范围归档，须人工核对，禁止覆盖。", 409);
      if (report.sourceRunId !== run.id && report.status !== "PUBLISHED") {
        const owner = await tx.amazonSyncRun.findUniqueOrThrow({ where: { id: report.sourceRunId }, select: { status: true } });
        if (["WAITING", "QUEUED", "RUNNING", "RETRY_WAIT", "PAUSED"].includes(owner.status)) return { busy: true as const, report };
        report = await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { sourceRunId: run.id } });
      }
      return { busy: false as const, report };
    });
    if (!claimed) return;
    if (claimed.busy) { await saveState("SETTLEMENT_OWNER_WAIT", "WAITING", new Date(now().getTime() + 60_000)); return; }
    const report = claimed.report;
    if (!report.rawTaskId) {
      const resumable = settlementRangeEnabled(scope);
      const rangedState = state as typeof state & { downloadParts?: SettlementPartsState; rangeDocument?: { value: unknown; expiresAt: string; documentDigest: string } };
      const documentDigest = digest([report.id, state.documentId]);
      const cachedDocument = rangedState.rangeDocument?.documentDigest === documentDigest && Date.parse(rangedState.rangeDocument.expiresAt) > now().getTime() ? rangedState.rangeDocument.value : undefined;
      const assembled = resumable && rangedState.downloadParts && rangedState.downloadParts.offset === rangedState.downloadParts.total;
      if (!assembled && !(resumable && cachedDocument) && budget && budget.nextRequestAt > now()) { await yieldSlice(run, budget.nextRequestAt); return; }
      let text: string;
      if (resumable) {
        if (rangedState.downloadParts) validateSettlementPartsState(rangedState.downloadParts, documentDigest);
        if (!rangedState.downloadParts || rangedState.downloadParts.offset < rangedState.downloadParts.total) {
          let document = cachedDocument;
          if (!document) {
            document = await client.getReportDocument(documentId).catch(async e => { await record(e); throw e; }); await record(); events.length = 0;
            // Amazon's signed document URL lasts five minutes; keep a one-minute margin.
            // This value only enters the AES-GCM cursor/task checkpoint, never DTO/logs.
            rangedState.rangeDocument = { value: document, expiresAt: new Date(now().getTime() + 240000).toISOString(), documentDigest };
            await saveState("SETTLEMENT_DOWNLOAD_READY"); return;
          }
          const prior = rangedState.downloadParts;
          const part = await client.downloadReportPart(document, prior ? { offset: prior.offset, total: prior.total, etag: prior.etag } : { offset: 0 }).catch(async e => { await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }, e); events.length = 0; throw e; });
          // Download logging does not consume or extend the Reports metadata budget.
          await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }); events.length = 0;
          await prisma.$transaction(async tx => {
            await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
            if (await stopForControl(tx, run)) return;
            const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
            if (current.sourceRunId !== run.id || current.rawTaskId) throw new SyncInputError("结算分段归档所有权已变化。", 409);
            rangedState.downloadParts = await storeSettlementPart(tx, scope, run.id, documentDigest, part, prior);
            const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
            await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
            await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "WAITING", stage: "SETTLEMENT_DOWNLOAD_PART", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
            await log(tx, run, "SETTLEMENT_PART_ARCHIVED");
          });
          return;
        }
        text = decodeReportParts(await prisma.$transaction(tx => readSettlementParts(tx, scope, source.id, rangedState.downloadParts!, documentDigest)));
      } else {
        if (rangedState.downloadParts) throw new SyncInputError("结算分段检查点需要已批准本机续传入口；保留证据并停止。", 409);
        const document = await client.getReportDocument(documentId).catch(async e => { await record(e); throw e; }); await record();
        text = await client.downloadReportText(document, localSellerEvidenceEnabled(scope) ? { timeoutMs: 90_000 } : {}).catch(async e => { await record(e); throw e; }); await record();
      }
      // Archive first so a parser rejection preserves the encrypted evidence.
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
        if (current.sourceRunId !== run.id || current.rawTaskId) throw new SyncInputError("结算归档所有权已变化。", 409);
        const lastRaw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id }, orderBy: { page: "desc" }, select: { page: true } });
        const page = (lastRaw?.page ?? 0) + 1, capturedAt = now(), hash = createHash("sha256").update(text).digest("hex");
        await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page, resource, requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId!, reportType: domainReportTypes.settlements, marketplaceIds, rawMayContainPii: true }, rawCiphertext: seal(rawReportEnvelope(text), scope, `${run.id}:${page}`, "amazon-settlements-raw.v1"), bodySha256: hash, capturedAt } });
        await registerArchivedFields(tx, run, page, text, "REPORT");
        await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { rawTaskId: run.id, rawPage: page, contentSha256: hash, capturedAt, status: "ARCHIVED" } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 } } });
      });
      await saveState("SETTLEMENT_ARCHIVED"); return;
    }
    let rows: ReturnType<typeof parseSettlementReport>["rows"] = [], rowCount = 0;
    {
      const archive = await prisma.amazonSyncRawPage.findUnique({ where: { taskId_page: { taskId: report.rawTaskId, page: report.rawPage! } } });
      if (!archive || archive.organizationId !== scope.organizationId || archive.workspaceId !== scope.workspaceId || archive.resource !== "settlements" || archive.bodySha256 !== report.contentSha256) throw new SyncInputError("结算密文原件来源不一致。", 409);
      const raw = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, "amazon-settlements-raw.v1") as { rawText: string };
      if (createHash("sha256").update(raw.rawText).digest("hex") !== report.contentSha256) throw new SyncInputError("结算原件摘要不一致。", 409);
      const parsed = parseSettlementReport(raw.rawText, marketplaceIds, settlement.bindings, { offset: state.offset ?? 0, limit: 500 });
      rows = parsed.rows; rowCount = parsed.rowCount;
    }
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const current = await tx.amazonSettlementReport.findUniqueOrThrow({ where: { id: report.id } });
      if (current.status !== "PUBLISHED" && current.sourceRunId !== run.id) throw new SyncInputError("结算解析所有权已变化。", 409);
      // Existing report tables are a site-scoped read projection. The seller-level
      // original and attribution rows above remain the durable settlement source.
      for (const binding of settlement.bindings.filter(b => b.sourceId === source.id)) {
        const documentId = digest([scope, binding.sourceId, state.reportId]);
        const prior = await tx.amazonSyncReportDocument.findUnique({ where: { organizationId_workspaceId_sourceId_reportId: { ...scope, sourceId: binding.sourceId, reportId: state.reportId! } } });
        if (prior && prior.contentSha256 !== report.contentSha256) throw new SyncInputError("结算站点投影与卖家级原件摘要冲突。", 409);
        await tx.amazonSyncReportDocument.createMany({ data: [{ id: documentId, ...scope, sourceId: binding.sourceId, sourceRunId: run.id, sellerAccountId: binding.sellerAccountId, amazonSellerId: report.amazonSellerId, marketplaceId: binding.marketplaceId, resource: "settlements", reportType: report.reportType, reportId: report.reportId, reportCreatedAt: report.createdTime, businessDateField: "posted-date or settlement-start-date", rowCount: 0, contentSha256: report.contentSha256!, status: "STAGED", capturedAt: report.capturedAt! }], skipDuplicates: true });
        const siteRows = rows.filter(r => r.binding?.sourceId === binding.sourceId);
        if (siteRows.length) await tx.amazonSyncReportRow.createMany({ data: siteRows.map(({ row }) => ({ id: digest([documentId, row.rowNumber]), ...scope, sourceId: binding.sourceId, reportDocumentId: documentId, reportId: report.reportId, ...row, fields: row.fields as Prisma.InputJsonValue })), skipDuplicates: true });
      }
      const inserted = await tx.amazonSettlementRow.createMany({ data: rows.map(({ row, status, binding }) => {
        const identity = { id: digest([report.id, row.rowNumber]), ...scope, reportDocumentId: report.id, rowNumber: row.rowNumber, rowHash: row.rowHash, attributionStatus: status };
        if (!binding) return identity;
        const { quantityOriginal: _quantity, fields, rowNumber: _number, rowHash: _hash, ...business } = row;
        void _quantity; void _number; void _hash;
        return { ...identity, ...business, sourceId: binding.sourceId, marketplaceId: binding.marketplaceId, sellerAccountId: binding.sellerAccountId, fields: fields as Prisma.InputJsonValue };
      }), skipDuplicates: true });
      const persistence = await recordSettlementFieldPersistence(tx, scope, run.requestedByUserId, {
        sourceId: source.id, reportDocumentId: report.id, rawTaskId: report.rawTaskId!, rawPage: report.rawPage!,
        rows: rows.filter(item => item.binding?.sourceId === source.id).map(item => item.row),
      });
      if (!persistence.passed) throw new SyncInputError("SETTLEMENT_FIELD_PERSISTENCE_MISMATCH：结算字段回读不一致，停止发布并保留原件。", 409);
      state.offset = (state.offset ?? 0) + rows.length;
      const complete = state.offset >= rowCount;
      if (complete && report.status !== "PUBLISHED") await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { status: "PUBLISHED", publishedAt: now() } });
      else if (!complete && report.status !== "PUBLISHED") await tx.amazonSettlementReport.update({ where: { id: report.id }, data: { status: "STAGED" } });
      if (complete) for (const binding of settlement.bindings.filter(b => b.sourceId === source.id)) {
        const documentId = digest([scope, binding.sourceId, state.reportId]);
        const rowCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: binding.sourceId, reportDocumentId: documentId } });
        const missingCurrency = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: binding.sourceId, reportDocumentId: documentId, amountOriginal: { not: null }, currencyCode: null } });
        await recordReportQualityIssue(tx, scope, run.requestedByUserId, { sourceId: binding.sourceId, taskId: run.id, reportId: report.reportId, code: "CURRENCY_MISSING", affectedRows: missingCurrency, affectedFields: ["currencyCode"], rawSha256: report.contentSha256!, checkedAt: now() });
        await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "PUBLISHED", rowCount, publishedAt: report.publishedAt ?? now() } });
      }
      const next = complete ? state.reportIds?.[(state.reportIndex ?? 0) + 1] : undefined;
      if (next) {
        state.reportIndex = (state.reportIndex ?? 0) + 1; state.reportId = next.reportId; state.reportCreatedAt = next.createdTime;
        delete state.documentId; delete state.marketplaceIds; delete state.offset; delete (state as typeof state & { downloadParts?: SettlementPartsState; rangeDocument?: unknown }).downloadParts; delete (state as typeof state & { rangeDocument?: unknown }).rangeDocument; state.polls = 0;
      }
      const finished = complete && !next;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: finished ? "SUCCEEDED" : "RUNNING", ...(finished ? { lastSuccessAt: now() } : {}) } });
      const publishedRowCount = await tx.amazonSettlementRow.count({ where: { ...scope, sourceId: source.id, attributionStatus: "ATTRIBUTED", document: { status: "PUBLISHED" } } });
      const quarantinedRows = await tx.amazonSettlementRow.count({ where: { ...scope, attributionStatus: { not: "ATTRIBUTED" }, document: { status: "PUBLISHED", ...reportKey, reportId: { in: (state.reportIds ?? []).map(r => r.reportId) } } } });
      const coverage = { reportType: domainReportTypes.settlements, discoveryWindow, historicalComplete: false, rowCount: publishedRowCount, quarantinedRows, attributionComplete: quarantinedRows === 0, capturedAt: now().toISOString(), businessDateField: "posted-date or settlement-start-date", reportIds: (state.reportIds ?? []).map(r => r.reportId) };
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: rows.length }, insertedCount: { increment: inserted.count }, status: finished ? "SUCCEEDED" : "WAITING", stage: finished ? "COMPLETED" : next ? "SETTLEMENT_NEXT_REPORT" : "SETTLEMENT_PARSING", finishedAt: finished ? now() : null, paginationComplete: finished, ...(finished ? { summary: { coverage } } : {}), nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      if (finished) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { rowCount: publishedRowCount, activeRunId: run.id, lastSuccessAt: now(), coverage } });
      await log(tx, run, finished ? "SETTLEMENT_PUBLISHED" : "SETTLEMENT_ROWS_COMMITTED");
    });
    return;
  };
}
