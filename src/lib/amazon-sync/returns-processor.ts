import { createHash, randomUUID } from "node:crypto";
import type { AmazonSyncRun, Prisma, PrismaClient } from "@prisma/client";
import { AmazonSpApiError, type AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { registerArchivedFields } from "./field-registry";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { persistWindowCheckpoints } from "./window-checkpoints";
import { rawReportEnvelope } from "./raw-fields";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { digest, seal, unseal } from "./approval-policy";
import { officialEndpoint, SyncInputError, type SyncScope } from "./policy";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { reserveOrderToken } from "./orders-rate-limit";
import { reportTimestampMatches, parseReturnPolicy, assertReturnRoles, returnWindowFromFrozen, returnCursorDigest, parseReturnState, parseReturnReport, returnPollDelay } from "./returns";

type ReturnSource = Prisma.AmazonSyncDataSourceGetPayload<{ include: { authorization: true; seller: true } }>;
type ReturnProcessorRuntime = {
  prisma: PrismaClient;
  leaseMs: number;
  scopeLock: (tx: Prisma.TransactionClient, scope: SyncScope) => Promise<void>;
  assertFence: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<AmazonSyncRun>;
  assertLiveSource: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<ReturnSource>;
  stopForControl: (tx: Prisma.TransactionClient, run: AmazonSyncRun) => Promise<boolean>;
  yieldSlice: (run: AmazonSyncRun, nextAttemptAt?: Date) => Promise<void>;
  log: (tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) => Promise<void>;
  persistOrderRequests: (run: AmazonSyncRun, events: AmazonRequestEvent[], bucketKey: string, configuredRate: number, now: Date, error?: unknown) => Promise<void>;
  fenceLost: () => Error;
};

export function assertReturnSourcePolicy(run: AmazonSyncRun, source: ReturnSource, scheduled: boolean) {
  assertReturnRoles(source.authorization, scheduled);
  const policy = parseReturnPolicy(source.returnsPolicy);
  if (digest(policy) !== digest(parseReturnPolicy((run.frozenScope as { returnsPolicy?: unknown }).returnsPolicy))) throw new Error();
  officialEndpoint(source.authorization.awsRegion, source.authorization.endpoint);
  if (!extractMarketplaceParticipations({ payload: source.authorization.marketplaceParticipations }).some(site => site.marketplaceId === source.marketplaceId)) throw new Error();
}

// 资源模块拥有退货报告生命周期；租约、实时授权与任务控制仍复用调度器护栏。
export function createReturnProcessor(runtime: ReturnProcessorRuntime) {
  const { prisma, leaseMs, scopeLock, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost } = runtime;
  return async function executeReturnSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
    const policy = parseReturnPolicy(source.returnsPolicy), auth = source.authorization;
    const window = returnWindowFromFrozen((run.frozenScope as { returnWindow?: unknown }).returnWindow), policyDigest = digest(policy);
    const historyReplay = (run.frozenScope as { returnHistoryReplay?: unknown }).returnHistoryReplay === true;
    if (historyReplay && run.trigger !== "schedule") throw new SyncInputError("退货历史补采只能由自动计划执行。", 403);
    const cursor = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      const old = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
      if (old && (old.resource !== "returns" || old.amazonSellerId !== auth.amazonSellerId || old.marketplaceId !== source.marketplaceId || old.organizationId !== scope.organizationId || old.workspaceId !== scope.workspaceId)) throw new SyncInputError("退货游标身份不匹配。", 403);
      if (historyReplay) {
        const expected = (run.frozenScope as { returnHistoryCursorDigest?: unknown }).returnHistoryCursorDigest;
        if (!old || old.status !== "SUCCEEDED" || Date.parse(window.from) < Date.parse(policy.initialFrom) || Date.parse(window.to) > old.watermarkTo.getTime() || old.detailPolicyDigest !== policyDigest || expected !== returnCursorDigest(old)) throw new SyncInputError("退货历史补采不匹配已完成的前向游标或当前策略。", 409);
        return old;
      }
      const starting = !old || old.status === "SUCCEEDED";
      if (old && !starting && (old.watermarkFrom.toISOString() !== window.from || old.watermarkTo.toISOString() !== window.to || old.detailPolicyDigest !== policyDigest)) throw new SyncInputError("退货窗口或策略与未完成游标不符。", 409);
      if (old?.status === "SUCCEEDED" && Date.parse(window.to) <= old.watermarkTo.getTime()) throw new SyncInputError("该退货窗口已完成。", 409);
      return tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "returns", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), status: "RUNNING", activeRunId: run.id, detailPolicyDigest: policyDigest }, update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), reportStateCiphertext: null, detailPolicyDigest: policyDigest } : {}) } });
    });
    const state = parseReturnState(historyReplay ? decryptCheckpoint(run.checkpointCiphertext, scope, run.id) : decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id));
    const saveReplayState = async () => {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        const current = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
        if (returnCursorDigest(current) !== (run.frozenScope as { returnHistoryCursorDigest: string }).returnHistoryCursorDigest) throw fenceLost();
        Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: encryptCheckpoint(JSON.stringify(state), scope, run.id), leaseExpiresAt: new Date(Date.now() + leaseMs) } }));
      });
    };
    const persistReportState = async () => {
      if (historyReplay) { await saveReplayState(); return; }
      const text = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: text } });
      });
      cursor.reportStateCiphertext = text;
    };
    if (state.terminalStatus) throw new SyncInputError("退货报告已确认失败或取消，请通过审批重试重新申请同一窗口。", 409);
    const commit = async (stage: string, mutate?: (tx: Prisma.TransactionClient) => Promise<void>, complete = false, nextAt = now()) => {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        const live = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
        if (historyReplay) {
          if (returnCursorDigest(live) !== (run.frozenScope as { returnHistoryCursorDigest: string }).returnHistoryCursorDigest) throw fenceLost();
        } else if (live.activeRunId !== run.id || live.reportStateCiphertext !== cursor.reportStateCiphertext) throw fenceLost();
        if (mutate) await mutate(tx);
        const ciphertext = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
        if (!historyReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: ciphertext, status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: now() } : {}) } });
        const priorSummary = run.summary && typeof run.summary === "object" && !Array.isArray(run.summary) ? run.summary as Prisma.JsonObject : {};
        const summary = historyReplay ? { ...priorSummary, historyReplay: true, cursorDigest: (run.frozenScope as { returnHistoryCursorDigest: string }).returnHistoryCursorDigest } : undefined;
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage, status: complete ? "SUCCEEDED" : "WAITING", paginationComplete: complete, ...(historyReplay ? { checkpointCiphertext: encryptCheckpoint(JSON.stringify(state), scope, run.id), summary: summary as Prisma.InputJsonValue } : {}), leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: nextAt, finishedAt: complete ? now() : null, dispatchVersion: { increment: 1 } } });
        if (complete) await persistWindowCheckpoints(tx, run, now());
        await log(tx, run, stage);
      }, { timeout: 60000 });
    };
    if (state.archiveTaskId) {
      const archive = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: 1, resource: "returns", task: { sourceId: source.id } } });
      if (!archive || !state.reportId) throw new SyncInputError("退货密文报告证据缺失。");
      const envelope = unseal(archive.rawCiphertext, scope, `${state.archiveTaskId}:1`, "amazon-returns-raw.v1") as { rawText: string };
      if (createHash("sha256").update(envelope.rawText).digest("hex") !== archive.bodySha256) throw new SyncInputError("退货报告原件校验失败。");
      const parsed = parseReturnReport(envelope.rawText, window, policy, state.offset);
      state.offset = parsed.nextOffset;
      await commit(parsed.complete ? "RETURN_REPORT_COMPLETED" : "RETURN_BATCH_COMMITTED", async tx => {
        let inserted = 0;
        for (const { reasonCode, ...row } of parsed.rows) {
          let reasonId: string | null = null;
          if (reasonCode) {
            reasonId = digest([scope, reasonCode]);
            await tx.amazonReturnReason.upsert({ where: { organizationId_workspaceId_code: { ...scope, code: reasonCode } }, create: { ...scope, id: reasonId, code: reasonCode }, update: {} });
          }
          const key = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, reportId: state.reportId!, rowHash: row.rowHash };
          const result = await tx.amazonReturnRecord.createMany({ data: [{ id: digest(key), ...key, amazonSellerId: auth.amazonSellerId, ...row, reasonId, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, marketplaceTimeZone: policy.marketplaceTimeZone, capturedAt: now() }], skipDuplicates: true });
          inserted += result.count;
        }
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: parsed.rows.length }, insertedCount: { increment: inserted }, skippedCount: { increment: parsed.rows.length - inserted } } });
        const storedRows = await tx.amazonReturnRecord.count({ where: { ...scope, sourceId: source.id, reportId: state.reportId } });
        await recordReportParseEvidence(tx, run, { rawTaskId: archive.taskId, rawPage: archive.page, phase: parsed.complete ? "PUBLISHED" : "ROWS_COMMITTED", rowsCommitted: storedRows, processedRows: state.offset, totalRows: parsed.total, checkedAt: now() });
        if (parsed.complete) {
          const rowCount = storedRows;
          const coverage = { type: "fba_received_returns_report", apiVersion: "2021-06-30", reportType: policy.reportType, reportId: state.reportId!, window, complete: true, returnsUniverseComplete: false, rowCount, rawRows: parsed.total, duplicateRows: parsed.total - rowCount, archiveTaskId: state.archiveTaskId!, reasonMapping: "RAW_CODE_ONLY" };
          if (!historyReplay) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: now(), rowCount, coverage } });
          await tx.amazonSyncRun.update({ where: { id: run.id }, data: { summary: { coverage, ...(historyReplay ? { historyReplay: true, cursorDigest: (run.frozenScope as { returnHistoryCursorDigest: string }).returnHistoryCursorDigest } : {}) } } });
        }
      }, parsed.complete);
      return;
    }
    if (state.creating && !state.reportId) throw new SyncInputError("退货报告申请结果不确定，禁止自动重复创建；需人工核查。");
    if (state.requestedAt && (state.polls >= policy.pollMaxAttempts || now().getTime() - Date.parse(state.requestedAt) > policy.pollDeadlineMinutes * 60000)) throw new SyncInputError("退货报告等待达到上限，保留报告与游标，需人工核查。");
    const operation = !state.reportId ? "createReport" : !state.documentId ? "getReport" : "getReportDocument";
    const budget = policy.budgets[operation], bucketKey = digest([`${operation}.2021-06-30`, auth.amazonSellerId, policy.applicationId]);
    // 退货也遵守既有 Reports 预算与其他报告流已观测到的限流。
    const oldBudget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: { ...scope, authorizationId: auth.id, operation } } });
    if (oldBudget && oldBudget.nextRequestAt > now()) { await yieldSlice(run, oldBudget.nextRequestAt); return; }
    const reservation = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
      const old = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
      const r = reserveOrderToken(old, budget, now());
      await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: r.tokens, replenishedAt: r.replenishedAt }, update: { tokens: r.tokens, replenishedAt: r.replenishedAt } }); return r;
    });
    if (!reservation.allowed) { await yieldSlice(run, reservation.nextAt); return; }
    const record = async (error?: unknown) => {
      await persistOrderRequests(run, events, bucketKey, budget.requestsPerSecond, now(), error);
      const key = { ...scope, authorizationId: auth.id, operation };
      const nextRequestAt = new Date(now().getTime() + Math.ceil(1000 / budget.requestsPerSecond));
      await prisma.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt }, update: { nextRequestAt } });
      events.length = 0;
    };
    const wait = () => new Date(now().getTime() + returnPollDelay(policy, state.polls));
    if (!state.reportId) {
      state.creating = true; state.requestedAt = now().toISOString();
      // 创建意图先持久化，保留当前 fenced lease 供未知结果处理。
      await persistReportState();
      events.length = 0;
      try {
        await prisma.$transaction(tx => assertLiveSource(tx, run));
        const response = await client.createReport({ reportType: policy.reportType, marketplaceId: source.marketplaceId, ...window }) as { reportId?: unknown };
        await record();
        if (typeof response.reportId !== "string" || !response.reportId || response.reportId.length > 200) throw new SyncInputError("退货报告 ID 无效，保留不确定创建状态。");
        state.reportId = response.reportId; state.creating = false;
        await commit("RETURN_REPORT_POLLING", undefined, false, wait());
      } catch (error) {
        if (events.length) await record(error);
        if (error instanceof AmazonSpApiError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 408) {
          state.creating = false;
          await persistReportState();
          throw error;
        }
        throw new SyncInputError("退货报告创建结果不确定，禁止自动重放，请人工核查。");
      }
      return;
    }
    state.polls++;
    events.length = 0;
    let response: unknown;
    try {
      await prisma.$transaction(tx => assertLiveSource(tx, run));
      response = state.documentId ? await client.getReportDocument(state.documentId) : await client.getReport(state.reportId);
      await record();
    } catch (error) {
      await record(error);
      if (error instanceof AmazonSpApiError && error.status === 404) { await commit("RETURN_RESOURCE_PENDING", undefined, false, wait()); return; }
      // 保留次数但不释放正常错误处理器仍需要的租约。
      await persistReportState();
      throw error;
    }
    if (!state.documentId) {
      const r = response as { reportId?: string; reportType?: string; marketplaceIds?: string[]; dataStartTime?: string; dataEndTime?: string; processingStatus?: string; reportDocumentId?: string };
      if (r.reportId !== state.reportId || r.reportType !== policy.reportType || !Array.isArray(r.marketplaceIds) || r.marketplaceIds.length !== 1 || r.marketplaceIds[0] !== source.marketplaceId || !reportTimestampMatches(r.dataStartTime, window.from) || !reportTimestampMatches(r.dataEndTime, window.to)) throw new SyncInputError("退货报告身份、站点或时间窗与审批不一致。");
      if (r.processingStatus === "IN_QUEUE" || r.processingStatus === "IN_PROGRESS") { await commit("RETURN_REPORT_POLLING", undefined, false, wait()); return; }
      if (r.processingStatus === "FATAL" || r.processingStatus === "CANCELLED") {
        state.terminalStatus = r.processingStatus;
        // 保存上游终态证据，不释放错误处理所需租约，不推断为空报告。
        if (historyReplay) await persistReportState();
        await prisma.$transaction(async tx => {
          await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
          if (!historyReplay) {
            const current = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
            if (current.activeRunId !== run.id || current.reportStateCiphertext !== cursor.reportStateCiphertext) throw fenceLost();
            await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: encryptCheckpoint(JSON.stringify(state), scope, cursor.id) } });
          }
          await tx.amazonSyncRun.update({ where: { id: run.id }, data: { stage: `RETURN_REPORT_${state.terminalStatus}` } });
          await log(tx, run, `RETURN_REPORT_${state.terminalStatus}`, "UPSTREAM_REPORT_TERMINAL");
        });
        throw new SyncInputError("Amazon 退货报告失败或取消；已保存终态证据，须经审批重试，未推断为空报告。", 409);
      }
      if (r.processingStatus !== "DONE" || !r.reportDocumentId || r.reportDocumentId.length > 200) throw new SyncInputError("退货报告失败、取消或文档身份缺失，未推断为空报告。");
      state.documentId = r.reportDocumentId; await commit("RETURN_REPORT_DOWNLOADING"); return;
    }
    if ((response as { reportDocumentId?: unknown })?.reportDocumentId !== state.documentId) throw new SyncInputError("退货文档身份不匹配。");
    events.length = 0;
    let text: string;
    try { await prisma.$transaction(tx => assertLiveSource(tx, run)); text = await client.downloadReportText(response); }
    catch (error) {
      await record(error);
      if (error instanceof AmazonSpApiError && [403, 404].includes(error.status ?? 0)) { await commit("RETURN_URL_REFRESH", undefined, false, wait()); return; }
      throw error;
    }
    await record();
    // 先加密归档再解析；解析修复重放原件而不是重新创建或下载报告。
    state.archiveTaskId = run.id; state.offset = 0;
    await commit("RETURN_REPORT_PARSING", async tx => {
      await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: 1, resource: "returns", requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId!, documentId: state.documentId!, reportType: policy.reportType, marketplaceId: source.marketplaceId, window, rawMayContainPii: true }, rawCiphertext: seal(rawReportEnvelope(text), scope, `${run.id}:1`, "amazon-returns-raw.v1"), bodySha256: createHash("sha256").update(text).digest("hex"), capturedAt: now() } });
      await registerArchivedFields(tx, run, 1, text, "REPORT");
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: 1, phase: "ARCHIVED", rowsCommitted: 0, checkedAt: now() });
    });
  };
}
