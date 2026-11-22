import { createHash } from "node:crypto";
import type { AmazonSyncRun, Prisma, PrismaClient } from "@prisma/client";
import { AmazonSpApiError, type AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { registerArchivedFields } from "./field-registry";
import { persistWindowCheckpoints } from "./window-checkpoints";
import { recordReportQualityIssue } from "./quality-issues";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { rawReportEnvelope } from "./raw-fields";
import { allListingsReportType, parseAllListingsReport } from "./catalog-report";
import { parseGetReportsPage } from "./domain-reports";
import { rangeFromFrozen } from "./date-range";
import { parseSalesTraffic, parseSalesTrafficProducts, salesTrafficReportType } from "./sales-traffic";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { digest, seal, unseal } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";

type ReportSource = Prisma.AmazonSyncDataSourceGetPayload<{ include: { authorization: true; seller: true } }>;
type ReportProcessorRuntime = {
  prisma: PrismaClient;
  leaseMs: number;
  scopeLock: (tx: Prisma.TransactionClient, scope: SyncScope) => Promise<void>;
  assertActor: (run: AmazonSyncRun) => Promise<void>;
  assertFence: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<AmazonSyncRun>;
  assertLiveSource: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<ReportSource>;
  stopForControl: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<boolean>;
  yieldSlice: (run: AmazonSyncRun, nextAttemptAt?: Date) => Promise<void>;
  log: (tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) => Promise<void>;
  persistRequests: (run: AmazonSyncRun, events: AmazonRequestEvent[], key: SyncScope & { authorizationId: string; operation: string }, error?: unknown) => Promise<void>;
};

// 两类报告共用创建、核对、归档状态机；发布仍遵守各资源原有合同。
export function createReportProcessor(runtime: ReportProcessorRuntime) {
  const { prisma, leaseMs, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests } = runtime;

  return async function executeReportSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], authorizationId: string, marketplaceId: string, sellerAccountId: string) {
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    const listing = run.resource === "catalog";
    const rawResource = listing ? "catalog" : "sales_traffic";
    const rawContext = listing ? "amazon-catalog-report-raw.v1" : "amazon-sales-traffic-raw.v1";
    const range = listing ? undefined : rangeFromFrozen(run.frozenScope);
    const checkpoint = decryptCheckpoint(run.checkpointCiphertext, scope, run.id);
    const state = checkpoint ? JSON.parse(checkpoint) as { creating?: boolean; reportId?: string; documentId?: string; requestedAt?: string; reconcileToken?: string; reconcileCandidates?: Array<{ reportId: string; createdTime: string | null }>; reconcilePages?: number; polls?: number } : {};
    const archivedReport = state.reportId && state.documentId ? await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page: 1, resource: rawResource } }) : null;
    if (run.trigger !== "schedule" && run.executionStartedAt && Date.now() - run.executionStartedAt.getTime() > 24 * 60 * 60_000) throw new Error("报告等待超过 24 小时，需重新审批。");
    const operation = !state.reportId ? state.creating ? "getReports" : "createReport" : !state.documentId ? "getReport" : "getReportDocument";
    const budgetKey = { ...scope, authorizationId, operation };
    const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
    if (!archivedReport && budget && budget.nextRequestAt > new Date()) { await yieldSlice(run, budget.nextRequestAt); return; }
    await assertActor(run);
    if (await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertLiveSource(tx, run); return stopForControl(tx, run); })) return;
    const saveState = async (stage: string) => {
      const updated = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        return tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage, checkpointCiphertext: encryptCheckpoint(JSON.stringify(state), scope, run.id), leaseExpiresAt: new Date(Date.now() + leaseMs) } });
      });
      Object.assign(run, updated);
    };
    if (state.creating && !state.reportId) {
      const requestedAt = Date.parse(state.requestedAt ?? "");
      if (!Number.isFinite(requestedAt)) throw new SyncInputError("报告创建检查点缺少申请时间，禁止重复创建。", 409);
      if ((state.reconcilePages ?? 0) >= 100) throw new SyncInputError("报告创建核对分页超过安全上限；保留原检查点。", 409);
      const reportType = listing ? allListingsReportType : salesTrafficReportType;
      const response = await client.getReports({ reportType, marketplaceId, createdSince: new Date(requestedAt - 5000).toISOString(), createdUntil: new Date().toISOString(), ...(state.reconcileToken ? { nextToken: state.reconcileToken } : {}) }).catch(async error => { await persistRequests(run, events, budgetKey, error); throw error; });
      await persistRequests(run, events, budgetKey);
      const page = parseGetReportsPage(response, reportType, marketplaceId);
      state.reconcilePages = (state.reconcilePages ?? 0) + 1;
      const reports = (response as { reports: Array<{ reportId: string; dataStartTime?: string; dataEndTime?: string }> }).reports;
      const matching = page.reports.filter(item => item.createdTime !== null && Date.parse(item.createdTime) >= requestedAt - 5000 && Date.parse(item.createdTime) <= Date.now() && (listing || reports.some(report => report.reportId === item.reportId && report.dataStartTime?.slice(0, 10) === range!.from && report.dataEndTime?.slice(0, 10) === range!.to)));
      state.reconcileCandidates = [...new Map([...(state.reconcileCandidates ?? []), ...matching].map(item => [item.reportId, item])).values()];
      if (state.reconcileCandidates.length > 1) throw new SyncInputError("报告创建核对发现多个匹配报告，无法安全确定原报告；未重复创建。", 409);
      if (page.nextToken) state.reconcileToken = page.nextToken;
      else {
        delete state.reconcileToken;
        if (state.reconcileCandidates.length === 1) { state.reportId = state.reconcileCandidates[0].reportId; state.creating = false; delete state.reconcileCandidates; }
        else {
          state.polls = (state.polls ?? 0) + 1;
          if (state.polls >= 100 || Date.now() - requestedAt > 24 * 60 * 60000) throw new SyncInputError("报告创建结果仍无法确认，保留原检查点，未重复创建。", 409);
        }
      }
      await saveState(state.reportId ? "REPORT_CREATE_RECONCILED" : "REPORT_CREATE_RECONCILING");
      await yieldSlice(run, new Date(Date.now() + 60000)); return;
    }
    let document: unknown;
    if (archivedReport) {
      const metadata = archivedReport.requestMetadata as { reportId?: unknown; documentId?: unknown; marketplaceId?: unknown };
      if (metadata.reportId !== state.reportId || metadata.documentId !== state.documentId || metadata.marketplaceId !== marketplaceId) throw new SyncInputError("报告原件身份与任务不一致。", 409);
      const envelope = unseal(archivedReport.rawCiphertext, scope, `${run.id}:1`, rawContext) as { rawText?: unknown };
      if (typeof envelope.rawText !== "string" || createHash("sha256").update(envelope.rawText).digest("hex") !== archivedReport.bodySha256) throw new SyncInputError("报告原件摘要校验失败。", 409);
      document = envelope.rawText;
    } else {
      let response: unknown;
      if (!state.reportId) {
        state.creating = true; state.requestedAt = new Date().toISOString(); await saveState("REPORT_CREATING");
        try { response = listing ? await client.createAllListingsReport(marketplaceId) : await client.createSalesTrafficReport({ marketplaceId, ...range!, asinGranularity: range!.productGranularity ?? "CHILD" }); }
        catch (error) {
          await persistRequests(run, events, budgetKey, error);
          // 明确拒绝可重试；其余错误可能已创建远端报告，先核对而非再次申请。
          if (error instanceof AmazonSpApiError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408) { state.creating = false; await saveState(error.status === 429 ? "REPORT_REQUEST_WAIT" : "REPORT_REQUEST_REJECTED"); throw error; }
          await saveState("REPORT_CREATE_RECONCILING");
          await yieldSlice(run, new Date(Date.now() + 60000)); return;
        }
        await persistRequests(run, events, budgetKey);
        const reportId = (response as { reportId?: unknown } | null)?.reportId;
        if (typeof reportId !== "string" || !reportId || reportId.length > 200) throw new Error("报告 ID 无效。");
        state.reportId = reportId; state.creating = false; await saveState("REPORT_POLLING");
        await yieldSlice(run, new Date(Date.now() + 60_000)); return;
      }
      try {
        response = state.documentId ? await client.getReportDocument(state.documentId) : await client.getReport(state.reportId);
      } catch (error) { await persistRequests(run, events, budgetKey, error); throw error; }
      await persistRequests(run, events, budgetKey);
      if (!state.documentId) {
        const report = response as { reportId?: unknown; reportType?: unknown; marketplaceIds?: unknown; processingStatus?: unknown; reportDocumentId?: unknown };
        if (report.reportId !== state.reportId || report.reportType !== (listing ? allListingsReportType : salesTrafficReportType) || !Array.isArray(report.marketplaceIds) || report.marketplaceIds.length !== 1 || report.marketplaceIds[0] !== marketplaceId) throw new Error("报告身份与任务不一致。");
        if (["CANCELLED", "FATAL"].includes(String(report.processingStatus))) throw new Error("Amazon 报告生成失败或取消。");
        if (["IN_QUEUE", "IN_PROGRESS"].includes(String(report.processingStatus))) { await yieldSlice(run, new Date(Date.now() + 60_000)); return; }
        if (report.processingStatus !== "DONE" || typeof report.reportDocumentId !== "string" || !report.reportDocumentId || report.reportDocumentId.length > 200) throw new Error("报告状态或文档 ID 无效。");
        state.documentId = report.reportDocumentId; await saveState("REPORT_DOWNLOADING");
        await yieldSlice(run); return;
      }
      if ((response as { reportDocumentId?: unknown } | null)?.reportDocumentId !== state.documentId) throw new Error("报告文档身份不匹配。");
      events.length = 0;
      try { document = listing ? await client.downloadReportText(response) : await client.downloadReportJsonText(response); }
      catch (error) { await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" }, error); throw error; }
      await persistRequests(run, events, { ...budgetKey, operation: "downloadReportDocument" });
    }
    if (typeof document !== "string") throw new SyncInputError("报告原件格式无效。", 422);
    const rawText = document, bodySha256 = createHash("sha256").update(rawText).digest("hex"), rawPage = 1;
    const archived = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return false;
      const prior = await tx.amazonSyncRawPage.findUnique({ where: { taskId_page: { taskId: run.id, page: rawPage } } });
      if (prior && (prior.resource !== rawResource || prior.bodySha256 !== bodySha256)) throw new SyncInputError("同一报告任务已归档不同原件；拒绝覆盖。", 409);
      if (!prior) await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: rawPage, resource: rawResource, requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId!, documentId: state.documentId!, reportType: listing ? allListingsReportType : salesTrafficReportType, marketplaceId, ...(range ? { requestedRange: range } : {}), rawMayContainPii: true }, rawCiphertext: seal(rawReportEnvelope(rawText), scope, `${run.id}:${rawPage}`, rawContext), bodySha256, capturedAt: new Date() } });
      await registerArchivedFields(tx, run, rawPage, rawText, "REPORT");
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage: "REPORT_PARSING", leaseExpiresAt: new Date(Date.now() + leaseMs) } });
      if (!prior) await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage, phase: "ARCHIVED", rowsCommitted: 0, checkedAt: new Date() });
      return true;
    });
    if (!archived) return;
    if (listing) {
      await publishAllListings(run, rawText, state.reportId!, state.documentId!, sellerAccountId, marketplaceId);
      return;
    }
    let reportBody: unknown;
    try { reportBody = JSON.parse(rawText); }
    catch { throw new SyncInputError("销售流量报告 JSON 无效；加密原件已保留，等待解析修复。", 422); }
    const result = parseSalesTraffic(reportBody, range!, marketplaceId), capturedAt = new Date();
    // 商品日事实：仅单日已闭合窗口可解析；多日窗口或无 ASIN 数据时跳过，绝不影响店铺日发布。
    let productResult: ReturnType<typeof parseSalesTrafficProducts> | null = null;
    if (range!.from === range!.to && range!.periodClosed && Array.isArray((reportBody as { salesAndTrafficByAsin?: unknown }).salesAndTrafficByAsin)) {
      try { productResult = parseSalesTrafficProducts(reportBody, range!, marketplaceId, range!.productGranularity ?? "CHILD"); }
      catch { productResult = null; }
    }
    await assertActor(run);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const rawEvidence = await tx.amazonSyncRawPage.findFirstOrThrow({ where: { ...scope, taskId: run.id, page: rawPage, resource: "sales_traffic" }, select: { capturedAt: true } });
      const head = source.activeRunId && source.activeRunId !== run.id ? await tx.amazonSyncRun.findFirst({ where: { ...scope, id: source.activeRunId, sourceId: source.id, resource: "sales_traffic", status: "SUCCEEDED" }, select: {
        startedAt: true, finishedAt: true, rawPages: { where: { ...scope, page: 1, resource: "sales_traffic" }, select: { capturedAt: true } },
      } }) : null;
      const headObservedAt = head?.rawPages[0]?.capturedAt ?? head?.finishedAt ?? head?.startedAt;
      const advanceHead = !headObservedAt || rawEvidence.capturedAt > headObservedAt || (rawEvidence.capturedAt.getTime() === headObservedAt.getTime() && run.startedAt >= head!.startedAt);
      await tx.amazonSalesTrafficSnapshot.createMany({ data: result.rows.map(row => ({ id: createHash("sha256").update(JSON.stringify([run.id, row.businessDate])).digest("hex"), ...scope, sourceId: source.id, syncRunId: run.id, sellerAccountId, marketplaceId, reportId: state.reportId!, documentId: state.documentId!, ...row, capturedAt: rawEvidence.capturedAt })) });
      // 商品日与店铺日分层：同一 run/原件/版本，仅在单日完整解析成功时写入，不覆盖店铺日。
      if (productResult && result.complete) {
        await tx.amazonSalesTrafficProductSnapshot.createMany({ data: productResult.rows.map(row => ({ id: createHash("sha256").update(JSON.stringify([run.id, row.businessDate, row.granularity, row.childAsin, row.sellerSku])).digest("hex"), ...scope, sourceId: source.id, syncRunId: run.id, sellerAccountId, marketplaceId, reportId: state.reportId!, documentId: state.documentId!, ...row, capturedAt: rawEvidence.capturedAt })) });
      }
      const qualityEvidence = { status: result.complete ? "PASSED" : "PARTIAL", code: result.complete ? "REPORT_WINDOW_COMPLETE" : "REPORT_WINDOW_INCOMPLETE", rawArchived: true, rawPage, rawSha256: bodySha256, parsedRows: result.rows.length, productRows: productResult?.rowCount ?? null, productGranularity: productResult?.granularity ?? null, missingDates: result.missingDates, periodClosed: range!.periodClosed, published: result.complete };
      await recordReportQualityIssue(tx, scope, run.requestedByUserId, { sourceId: source.id, taskId: run.id, reportId: state.reportId!, code: "DATE_COVERAGE_INCOMPLETE", affectedRows: result.missingDates.length + result.rows.filter(row => row.quality !== "VALID").length + (range!.periodClosed ? 0 : 1), affectedFields: ["businessDate", "metrics"], from: range!.from, to: range!.to, rawSha256: bodySha256, checkedAt: capturedAt });
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage, phase: result.complete ? "PUBLISHED" : "ROWS_COMMITTED", rowsCommitted: result.rows.length, totalRows: result.rows.length, checkedAt: capturedAt });
      const coverage = { type: "report_business_dates", requestedRange: range, actualFrom: result.rows.map(r => r.businessDate).sort()[0] ?? null, actualTo: result.rows.map(r => r.businessDate).sort().at(-1) ?? null, missingDates: result.missingDates, complete: result.complete, periodClosed: range!.periodClosed, quality: result.complete ? "VALID" : "INCOMPLETE", qualityEvidence, rawPage, rawSha256: bodySha256, sourceApi: "Reports 2021-06-30", reportType: salesTrafficReportType, reportId: state.reportId!, documentId: state.documentId!, fetchedAt: rawEvidence.capturedAt.toISOString(), transformed: true, granularity: "SELLER_DAY", rowCount: result.rows.length, product: productResult ? { granularity: productResult.granularity, rowCount: productResult.rowCount, complete: productResult.complete } : null };
      // 部分报告只保存质量证据，不能替换原有完整发布版本。
      if (result.complete && advanceHead) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: result.rows.length, coverage } });
      else if (!result.complete) await tx.amazonSyncDataSource.updateMany({ where: { ...scope, id: source.id, activeRunId: source.activeRunId }, data: { coverage: { ...((source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage)) ? source.coverage as Prisma.JsonObject : {}), latestQualityAttempt: qualityEvidence } } });
      const publishedProductRows = productResult && result.complete ? productResult.rowCount : 0;
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: result.complete ? "SUCCEEDED" : "PARTIAL_SUCCESS", stage: result.complete ? "COMPLETED" : "QUALITY_FAILED", pagesCompleted: 1, paginationComplete: true, processedCount: result.rows.length + publishedProductRows, insertedCount: result.rows.length + publishedProductRows, finishedAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: result.complete ? null : encryptCheckpoint(JSON.stringify(state), scope, run.id), summary: { provider: "amazon_sp_api", executionVersion: 2, quality: qualityEvidence, coverage, publishedAt: result.complete ? capturedAt.toISOString() : null, publication: { observedAt: rawEvidence.capturedAt.toISOString(), headAdvanced: result.complete && advanceHead, productRows: publishedProductRows } }, error: result.complete ? null : !range!.periodClosed ? "业务日期尚未闭合；保留报告证据，未发布为完整数据。" : "报告缺日或缺少字段；保留当前有效版本，未发布本次结果。" } });
      await persistWindowCheckpoints(tx, run, capturedAt);
      await log(tx, run, result.complete ? "PUBLISHED" : "QUALITY_REJECTED");
    });
  };

  async function publishAllListings(run: AmazonSyncRun, text: string, reportId: string, documentId: string, sellerAccountId: string, marketplaceId: string) {
    const rows = parseAllListingsReport(text), capturedAt = new Date();
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    await assertActor(run);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const coverage = { type: "complete_snapshot", sourceApi: "Reports 2021-06-30", reportType: allListingsReportType, reportId, documentId, rowCount: rows.length, paginationComplete: true, capturedTo: capturedAt.toISOString(), historicalSnapshot: false };
      await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, tokenHash: digest([reportId, documentId]), page: 1, rowCount: rows.length } });
      for (let i = 0; i < rows.length; i += 500) {
        await tx.amazonCatalogSnapshot.createMany({ data: rows.slice(i, i + 500).map(row => ({ ...scope, id: digest([run.id, row.sellerSku]), sellerAccountId, marketplaceId, sourceRunId: run.id, ...row, capturedAt, sourceUpdatedAt: null, fieldSources: { sellerSku: allListingsReportType, asin: allListingsReportType, listingStatus: allListingsReportType, fulfillmentType: allListingsReportType, ...(row.listingAttributes ? { listingAttributes: allListingsReportType } : {}) } })) });
      }
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: 1, phase: "PUBLISHED", rowsCommitted: rows.length, totalRows: rows.length, checkedAt: capturedAt });
      await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: rows.length, coverage } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", pagesCompleted: 1, paginationComplete: true, processedCount: rows.length, insertedCount: rows.length, finishedAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { provider: "amazon_sp_api", executionVersion: 2, coverage, snapshotCount: rows.length } } });
      await log(tx, run, "PUBLISHED");
    }, { timeout: 30000 });
  }
}
