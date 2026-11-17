import { randomUUID } from "node:crypto";
import { Prisma, type AmazonSyncRun, type PrismaClient } from "@prisma/client";
import type { AmazonSpApiClient, AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { registerArchivedFields } from "./field-registry";
import { persistWindowCheckpoints } from "./window-checkpoints";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { archiveResponse, replayResponse } from "./response-evidence";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { digest, seal, unseal, targetEnvironment } from "./approval-policy";
import { SyncInputError, type SyncScope } from "./policy";
import { reserveOrderToken } from "./orders-rate-limit";
import { FinanceParseError, parseFinancePolicy, financeWindowFromFrozen, financeCursorDigest, assertFinanceRequestWindow, attributeFinanceTransaction, convertFinanceMoney } from "./finance";
import { financeParser, financeParserCanRecover, parseFinanceResponse } from "./finance-parser";

type FinanceSource = Prisma.AmazonSyncDataSourceGetPayload<{ include: { authorization: true; seller: true } }>;
type FinanceProcessorRuntime = {
  prisma: PrismaClient;
  maxPages: number;
  maxRows: number;
  scopeLock: (tx: Prisma.TransactionClient, scope: SyncScope) => Promise<void>;
  assertActor: (run: AmazonSyncRun) => Promise<void>;
  assertFence: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<AmazonSyncRun>;
  assertLiveSource: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<FinanceSource>;
  stopForControl: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<boolean>;
  yieldSlice: (run: AmazonSyncRun, nextAttemptAt?: Date) => Promise<void>;
  log: (tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) => Promise<void>;
  persistOrderRequests: (run: AmazonSyncRun, events: AmazonRequestEvent[], bucketKey: string, configuredRate: number, now: Date, error?: unknown) => Promise<void>;
  fenceLost: () => Error;
};

// 财务资源拥有分页、隔离恢复和发布生命周期；共享调度护栏由主处理器注入。
export function createFinanceProcessor(runtime: FinanceProcessorRuntime) {
  const { prisma, maxPages, maxRows, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost } = runtime;
  return async function executeFinanceSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    await assertActor(run);
    const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
    const policy = parseFinancePolicy(source.financePolicy), auth = source.authorization;
    const financeFrozen = run.frozenScope as { financeWindow?: unknown; financeHistoryReplay?: unknown; financeHistoryCursorDigest?: unknown };
    const financeHistoryReplay = financeFrozen.financeHistoryReplay === true;
    if (financeHistoryReplay && run.trigger !== "schedule") throw new SyncInputError("Finance 历史补采只能由自动计划执行。", 403);
    const window = financeWindowFromFrozen(financeFrozen.financeWindow);
    const recovery = (run.frozenScope as { financeSiteRecovery?: { version?: string; approvalId?: string; taskId?: string; sourceId?: string; sourceRevision?: number; rawPage?: number; rawSha256?: string } }).financeSiteRecovery;
    if (recovery) {
      if (recovery.version !== "finance-site-quarantine.v1" || recovery.taskId !== run.id || recovery.sourceId !== source.id || recovery.sourceRevision !== source.revision || recovery.approvalId !== run.executionApprovalId) throw new SyncInputError("财务隔离恢复审批身份不匹配。", 403);
      const grant = await prisma.amazonDataCenterChangeRequest.findFirst({ where: { ...scope, id: recovery.approvalId, status: "APPLIED", operation: "control-task", targetId: run.id, targetEnvironment: targetEnvironment(), sourceIds: { has: source.id } }, select: { id: true } });
      const original = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page: recovery.rawPage, bodySha256: recovery.rawSha256, resource: "finance" }, select: { page: true } });
      if (!grant || !original) throw new SyncInputError("财务隔离恢复审批或失败页原件失效。", 403);
    }
    const policyDigest = digest(policy);
    const bucketKey = digest(["listTransactions.2024-06-19", auth.amazonSellerId, policy.applicationId]);
    const prepared = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return null;
      let cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
      if (cursor && (cursor.resource !== "finance" || cursor.amazonSellerId !== auth.amazonSellerId || cursor.marketplaceId !== source.marketplaceId || cursor.organizationId !== scope.organizationId || cursor.workspaceId !== scope.workspaceId)) throw new SyncInputError("财务游标身份不匹配。", 403);
      if (financeHistoryReplay) {
        const expected = financeFrozen.financeHistoryCursorDigest;
        if (!cursor || cursor.status !== "SUCCEEDED" || Date.parse(window.to) > cursor.watermarkTo.getTime() || cursor.detailPolicyDigest !== policyDigest || typeof expected !== "string" || expected !== financeCursorDigest(cursor)) throw new SyncInputError("Finance 历史补采不匹配已完成的前向游标或当前策略。", 409);
      } else {
        if (cursor && cursor.status !== "SUCCEEDED" && (cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to || cursor.detailPolicyDigest !== policyDigest)) throw new SyncInputError("财务窗口或策略与未完成游标不匹配。", 409);
        if (cursor?.status === "SUCCEEDED" && Date.parse(window.to) <= cursor.watermarkTo.getTime()) throw new SyncInputError("财务窗口已完成，请重新申请后续窗口。", 409);
        const starting = !cursor || cursor.status === "SUCCEEDED";
        cursor = await tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "finance", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), activeRunId: run.id, status: "RUNNING", detailPolicyDigest: policyDigest }, update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), nextTokenCiphertext: null, detailPolicyDigest: policyDigest } : {}) } });
      }
      // 已归档原件回放不消耗远端预算，身份及摘要仍由 replayResponse 核验。
      if (await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: "finance", page: run.pagesCompleted + 1 }, select: { page: true } })) return { cursor, reservation: { allowed: true, nextAt: now() } };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
      const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
      const reservation = reserveOrderToken(bucket, policy, now());
      await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: reservation.tokens, replenishedAt: reservation.replenishedAt }, update: { tokens: reservation.tokens, replenishedAt: reservation.replenishedAt } });
      return { cursor, reservation };
    });
    if (!prepared) return;
    if (!prepared.reservation.allowed) { await yieldSlice(run, prepared.reservation.nextAt); return; }
    const token = financeHistoryReplay ? decryptCheckpoint(run.checkpointCiphertext, scope, run.id) : decryptCheckpoint(prepared.cursor.nextTokenCiphertext, scope, prepared.cursor.id);
    const replay = prepared.cursor.reportStateCiphertext ? JSON.parse(decryptCheckpoint(prepared.cursor.reportStateCiphertext, scope, prepared.cursor.id) ?? "null") as { replayApprovalId?: string; window?: { from?: string; to?: string } } | null : null;
    const replayId = replay?.replayApprovalId && replay.window?.from === window.from && replay.window?.to === window.to ? replay.replayApprovalId : undefined;
    const financeTokenHash = (value: string | null) => replayId ? digest([window, policyDigest, value, replayId]) : financeHistoryReplay ? digest([window, policyDigest, value, "history-replay", run.id]) : digest([window, policyDigest, value]);
    const tokenHash = financeTokenHash(token ?? null);
    if (await prisma.amazonSyncPage.findFirst({ where: { ...scope, tokenHash, task: { sourceId: source.id } } })) throw new SyncInputError("财务分页循环，未推进游标。");
    events.length = 0;
    const pageNumber = run.pagesCompleted + 1;
    const responseIdentity = { apiVersion: "2024-06-19", operation: "listTransactions", window, pageTokenHash: tokenHash, policyDigest };
    const archived = await replayResponse(run, pageNumber, responseIdentity);
    let response: Awaited<ReturnType<AmazonSpApiClient["listTransactions"]>>;
    try {
      await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); });
      // 等待预算后重新核验窗口，冻结起点会随等待老化。
      if (archived === null) assertFinanceRequestWindow(window, now());
      response = archived === null ? await client.listTransactions({ postedAfter: window.from, postedBefore: window.to, nextToken: token }) : { rawBody: archived };
    } catch (error) { await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now(), error); throw error; }
    if (archived === null) {
      await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now());
      await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await archiveResponse(tx, run, pageNumber, responseIdentity, response.rawBody); });
    }
    let parsed: ReturnType<typeof parseFinanceResponse>;
    try {
      const frozenVersion = (run.frozenScope as { financeParserVersion?: string }).financeParserVersion;
      if (frozenVersion && frozenVersion !== financeParser.version && !financeParserCanRecover(frozenVersion, null)) throw new FinanceParseError("财务任务解析器版本需要人工审阅。", "PARSER_VERSION_REVIEW_REQUIRED");
      parsed = parseFinanceResponse(response.rawBody, { sourceCode: responseIdentity.operation, apiVersion: responseIdentity.apiVersion, responseType: "JSON" }, window);
    } catch (error) {
      if (error instanceof FinanceParseError) await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: pageNumber, phase: "ATTEMPT_FAILED", rowsCommitted: 0, checkedAt: now(), replayed: archived !== null,
          failureCode: error.code, finance: { diagnostic: { code: error.code, offset: error.offset, path: error.path } } });
      });
      throw error;
    }
    const { page } = parsed;
    if (run.pagesCompleted >= maxPages || run.processedCount + page.transactions.length > maxRows) throw new SyncInputError("财务窗口超过安全容量，保留游标并停止。");
    if (page.nextToken && financeTokenHash(page.nextToken) === tokenHash) throw new SyncInputError("财务分页循环，未推进游标。");
    // 仅显式审批恢复允许未知站点行加密隔离，不能暴露可查询站点或金额。
    const rows = page.transactions.map(row => {
      const attribution = attributeFinanceTransaction(row, auth.amazonSellerId, policy, !!recovery);
      return { row, attribution, converted: attribution.reason ? null : convertFinanceMoney(row.amount, row.postedAt, policy) };
    });
    const capturedAt = now();
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const cursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
      if (cursor.captureSequence !== prepared.cursor.captureSequence || (financeHistoryReplay
        ? cursor.activeRunId !== prepared.cursor.activeRunId || cursor.nextTokenCiphertext !== prepared.cursor.nextTokenCiphertext || financeCursorDigest(cursor) !== (run.frozenScope as { financeHistoryCursorDigest?: unknown }).financeHistoryCursorDigest
        : cursor.activeRunId !== run.id || cursor.nextTokenCiphertext !== prepared.cursor.nextTokenCiphertext)) throw fenceLost();
      const priorParse = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, action: "amazon.sync.report.parse-checkpoint", entityId: run.id,
        AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { metadata: { path: ["rawPage"], equals: pageNumber } }, { metadata: { path: ["phase"], equals: "ROWS_COMMITTED" } }] }, orderBy: { createdAt: "desc" } });
      const priorDigest = (priorParse?.metadata as { resultDigest?: string } | null)?.resultDigest;
      if (priorDigest && priorDigest !== parsed.resultDigest) throw new SyncInputError("新财务解析结果与已提交历史结果不同，须人工审阅；原件和业务结果未覆盖。", 409);
      const observationSequence = cursor.captureSequence + 1;
      let inserted = 0, updated = 0, skipped = 0;
      const preservedReplayRows = new Map<string, string>();
      for (const { row, attribution, converted } of rows) {
        const key = { ...scope, sellerAccountId: source.sellerAccountId, transactionId: row.transactionId };
        const existing = await tx.amazonFinanceRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_transactionId: key } });
        if (financeHistoryReplay && existing) { preservedReplayRows.set(row.transactionId, existing.rowHash); skipped++; continue; }
        if (attribution.reason && existing?.attributionStatus === "ATTRIBUTED") throw new SyncInputError("隔离行不能覆盖已有正确归属的财务记录。", 409);
        if (existing && (existing.sourceId !== source.id || existing.observationSequence >= observationSequence)) throw new SyncInputError("财务采集顺序或来源冲突，禁止旧观察覆盖新事实。");
        const rowHash = digest({ ...row, postedAt: row.postedAt.toISOString(), attribution, converted });
        if (existing?.rowHash === rowHash) { skipped++; continue; }
        const id = existing?.id ?? digest(key), quarantined = !!attribution.reason;
        const data = { ...key, amazonSellerId: auth.amazonSellerId, sourceId: source.id, sourceRunId: run.id,
          marketplaceId: attribution.marketplaceId, marketplaceTimeZone: attribution.marketplaceTimeZone, attributionStatus: quarantined ? "QUARANTINED" : "ATTRIBUTED", quarantineReason: attribution.reason,
          postedAt: row.postedAt, transactionType: quarantined ? null : row.transactionType, rawStatus: quarantined ? null : row.rawStatus,
          orderId: quarantined ? null : row.orderId, classification: quarantined ? "UNATTRIBUTED" : row.classification,
          originalAmount: quarantined ? null : row.amount.original, amount: quarantined ? null : row.amount.original, currency: quarantined ? null : row.amount.currency,
          convertedAmount: converted?.amount ?? null, convertedCurrency: converted?.currency ?? null, conversionStatus: converted?.status ?? "QUARANTINED",
          fxEvidence: converted?.evidence ? converted.evidence as Prisma.InputJsonValue : Prisma.DbNull,
          observationSequence, rowHash, capturedAt };
        await tx.amazonFinanceRecord.upsert({ where: { organizationId_workspaceId_sellerAccountId_transactionId: key }, create: { id, ...data }, update: data });
        if (quarantined) await tx.amazonFinanceQuarantine.upsert({ where: { recordId: id }, create: { ...scope, recordId: id, ciphertext: seal({ ...row, postedAt: row.postedAt.toISOString() }, scope, id, "amazon-finance-quarantine.v1"), createdAt: capturedAt }, update: { ciphertext: seal({ ...row, postedAt: row.postedAt.toISOString() }, scope, id, "amazon-finance-quarantine.v1"), createdAt: capturedAt } });
        else await tx.amazonFinanceQuarantine.deleteMany({ where: { ...scope, recordId: id } });
        if (existing) updated++; else inserted++;
      }
      const stored = await tx.amazonFinanceRecord.findMany({ where: { ...scope, sourceId: source.id, transactionId: { in: rows.map(item => item.row.transactionId) } }, select: {
        id: true, transactionId: true, rowHash: true, originalAmount: true, currency: true, postedAt: true, marketplaceId: true, orderId: true, observationSequence: true,
        attributionStatus: true, convertedAmount: true, quarantine: { select: { ciphertext: true } },
      } });
      const expected = new Map(rows.map(item => [item.row.transactionId, item]));
      const validStored = stored.every(record => {
        const item = expected.get(record.transactionId);
        if (!item) return false;
        const preservedHash = preservedReplayRows.get(record.transactionId);
        if (financeHistoryReplay && preservedHash) return record.rowHash === preservedHash && record.observationSequence <= cursor.captureSequence;
        const { row, attribution, converted } = item, quarantined = !!attribution.reason;
        return record.rowHash === digest({ ...row, postedAt: row.postedAt.toISOString(), attribution, converted })
          && record.postedAt.getTime() === row.postedAt.getTime() && record.marketplaceId === attribution.marketplaceId
          && record.originalAmount === (quarantined ? null : row.amount.original) && record.currency === (quarantined ? null : row.amount.currency)
          && record.orderId === (quarantined ? null : row.orderId) && record.attributionStatus === (quarantined ? "QUARANTINED" : "ATTRIBUTED")
          && (record.convertedAmount?.toString() ?? null) === (converted?.amount ? new Prisma.Decimal(converted.amount).toString() : null)
          && (!quarantined || !!record.quarantine && digest(unseal(record.quarantine.ciphertext, scope, record.id, "amazon-finance-quarantine.v1")) === digest({ ...row, postedAt: row.postedAt.toISOString() }));
      });
      if (stored.length !== rows.length || !validStored || inserted + updated + skipped !== rows.length) throw new SyncInputError("财务入库回读或计数校验失败；检查点未推进。", 409);
      await registerArchivedFields(tx, run, pageNumber, response.rawBody, "JSON");
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: pageNumber, phase: "ROWS_COMMITTED", rowsCommitted: rows.length, totalRows: rows.length, checkedAt: capturedAt, replayed: archived !== null,
        finance: { resultDigest: parsed.resultDigest, counts: { inserted, updated, reused: skipped, quarantined: rows.filter(item => !!item.attribution.reason).length } } });
      await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, tokenHash, rowCount: rows.length } });
      const complete = !page.nextToken;
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { captureSequence: observationSequence, ...(!financeHistoryReplay ? { nextTokenCiphertext: encryptCheckpoint(page.nextToken, scope, cursor.id), status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } : {}) } });
      const where = { ...scope, sourceId: source.id };
      const rowCount = await tx.amazonFinanceRecord.count({ where });
      const quarantinedCount = await tx.amazonFinanceRecord.count({ where: { ...where, attributionStatus: "QUARANTINED" } });
      const unconvertedCount = await tx.amazonFinanceRecord.count({ where: { ...where, conversionStatus: "UNCONVERTED" } });
      const previousCoverage = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
      const retentionGaps = Array.isArray(previousCoverage.retentionGaps) ? previousCoverage.retentionGaps : [];
      const coverage = { type: "posted_incremental_window", apiVersion: "2024-06-19", window, sellerWide: true, marketplaceIds: policy.marketplaces.map(m => m.marketplaceId), transportComplete: complete, financialFinal: false, overlapSeconds: policy.overlapSeconds, rowCount, quarantinedCount, unconvertedCount, ...(financeHistoryReplay ? { financeHistoryReplay: true } : {}), ...(retentionGaps.length ? { retentionGaps, historicalComplete: false } : {}) };
      if (complete && !financeHistoryReplay) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount, coverage } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : "FETCHING", pagesCompleted: { increment: 1 }, processedCount: { increment: rows.length }, insertedCount: { increment: inserted }, updatedCount: { increment: updated }, skippedCount: { increment: skipped }, paginationComplete: complete, checkpointCiphertext: encryptCheckpoint(page.nextToken, scope, run.id), summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      if (complete) {
        await persistWindowCheckpoints(tx, run, capturedAt);
        await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: pageNumber, phase: "PUBLISHED", rowsCommitted: rows.length, totalRows: rows.length, checkedAt: capturedAt, replayed: archived !== null, finance: { resultDigest: parsed.resultDigest } });
      }
      await log(tx, run, complete ? "FINANCE_WINDOW_COMPLETED" : "FINANCE_PAGE_COMMITTED");
    }, { timeout: 60000 });
  };
}
