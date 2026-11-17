import { isInventoryReport, inventoryReportParserVersion } from "./inventory-report-contracts";
import { recordDomainReportFieldPersistence } from "./field-persistence-evidence";
import { registerArchivedFields } from "./field-registry";
import { persistWindowCheckpoints } from "./window-checkpoints";
import { recordReportQualityIssue } from "./quality-issues";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { rawReportEnvelope } from "./raw-fields";
import { requiresReportRowAttribution } from "./report-row-attribution";
import { assertSettlementMarketplaces, type SettlementPolicy, type SettlementBinding } from "./settlements";
import { markReportRowAttribution, persistReportAttributionMarkers, reportVerifiedRowWhere } from "./report-row-attribution";
import { reportTimestampMatches } from "./returns";
import { sellerArchivePolicy } from "./seller-archive-policy";
import { isRemovalReport, assertDomainReportRoles, assertDomainReportReady, assertSettlementDiscoveryAvailable, domainReportRunWindow, domainReportTypes, parseDomainReport, parseGetReportsPage, domainReportHistoryCursorDigest, type DomainReportResource } from "./domain-reports";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { SyncInputError } from "./policy";
import { digest, seal, unseal } from "./approval-policy";
import type { SyncProcessorRuntime } from './processor-runtime';
import type { DomainReportState } from './domain-report-state';
import { createSettlementProcessor } from './settlement-processor';

export function createDomainReportProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "leaseMs" | "scopeLock" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistRequests">) {
  const { prisma, leaseMs, scopeLock, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests } = runtime;
  const executeSettlementSlice = createSettlementProcessor(runtime);
return async function executeDomainReportSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const resource = run.resource as DomainReportResource;
  if (!Object.hasOwn(domainReportTypes, resource)) throw new SyncInputError("未注册的 Amazon 报告域。");
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const frozenHistory = run.frozenScope as { reimbursementHistoryReplay?: unknown; reimbursementHistoryCursorDigest?: unknown; inventoryEventHistoryReplay?: unknown; inventoryEventHistoryCursorDigest?: unknown };
  const domainHistoryReplay = resource === "reimbursements" && frozenHistory.reimbursementHistoryReplay === true
    || resource === "inventory_events" && frozenHistory.inventoryEventHistoryReplay === true;
  const historyCursorDigest = resource === "reimbursements" ? frozenHistory.reimbursementHistoryCursorDigest : frozenHistory.inventoryEventHistoryCursorDigest;
  if (domainHistoryReplay && run.trigger !== "schedule") throw new SyncInputError("报告历史补采只能由自动计划执行。", 403);
  const archivePolicy = sellerArchivePolicy(resource, source.domainPolicy);
  assertDomainReportRoles(resource, source.authorization, run.trigger === "schedule" || !!archivePolicy);
  const window = domainReportRunWindow(resource, (run.frozenScope as { reportWindow?: unknown }).reportWindow, now());
  const discoveryWindow = window && "createdSince" in window ? window : null;
  const settlement = resource === "settlements" ? (run.frozenScope as { settlement?: { policy: SettlementPolicy; bindings: SettlementBinding[] } }).settlement : undefined;
  const inventoryEventWindow = window && "eventType" in window ? window : null;
  const reimbursementWindow = resource === "reimbursements" && window && "dataStartTime" in window ? window : null;
  const removalOrderWindow = isRemovalReport(resource) && window && "dataStartTime" in window ? window : null;
  const fbaShipmentsWindow = resource === "fba_shipments" && window && "dataStartTime" in window ? window : null;
  const mfnReturnsWindow = resource === "mfn_returns" && window && "dataStartTime" in window ? window : null;
  const storageFeeWindow = resource === "long_term_storage_fees" && window && "dataStartTime" in window ? window : null;
  const reportDataWindow = inventoryEventWindow ?? reimbursementWindow ?? removalOrderWindow ?? fbaShipmentsWindow ?? mfnReturnsWindow ?? storageFeeWindow;
  const inventoryOverageCoverage = resource === "fba_overage_fees" ? { type: "ESTIMATE_SNAPSHOT", status: "PARTIAL", historicalComplete: false, officialHistoricalQueryWindow: null, missingCapabilities: ["OFFICIAL_HISTORICAL_QUERY_WINDOW", "OLDER_SNAPSHOT_RECONCILIATION"], incrementalStrategy: "DAILY_ON_DEMAND_ESTIMATE_SNAPSHOT_KEEP_VERSIONS", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: inventoryReportParserVersion, amountSemantics: "ESTIMATED_OVERAGE_FEE_NOT_POSTED_CHARGE" } : resource === "fee_preview" ? { type: "ESTIMATE_SNAPSHOT", status: "PARTIAL", historicalComplete: false, officialHistoricalQueryWindow: null, missingCapabilities: ["OFFICIAL_HISTORICAL_QUERY_WINDOW", "OLDER_SNAPSHOT_RECONCILIATION"], incrementalStrategy: "DAILY_SELLER_LIMIT_ROTATES_MARKETPLACES_KEEP_PUBLISHED_SNAPSHOTS", officialRefreshCycle: "AT_LEAST_EVERY_72_HOURS", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: inventoryReportParserVersion, amountSemantics: "ESTIMATED_FBA_FEES_NOT_POSTED_CHARGES" } : {};
  const storageFeeCoverage = storageFeeWindow ? { storageFeeWindow, type: "monthly_charge_report", status: "PARTIAL", historicalComplete: false, officialRetentionDays: null, historyStart: "LATEST_CLOSED_MONTH_ON_INITIAL_COLLECTION", missingCapabilities: ["OFFICIAL_HISTORY_RETENTION_POLICY", "OLDER_MONTH_CORRECTION_RECONCILIATION"], incrementalStrategy: "CALENDAR_MONTH_CATCHUP_DAILY_LATEST_MONTH_REFRESH", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2" } : resource === "fba_customer_sales" ? { type: "LATEST_REQUESTED_SNAPSHOT", status: "PARTIAL", historicalComplete: false, historyWindow: null, missingCapabilities: ["OFFICIAL_HISTORICAL_QUERY_WINDOW", "HISTORICAL_COMPLETENESS_RECONCILIATION"], incrementalStrategy: "DAILY_LATEST_SNAPSHOT_WITH_24_HOUR_DELAY_ALLOWANCE", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", rawMayContainPii: true, structuredFieldsContainShipToPii: false } : resource === "mfn_returns" ? { type: "ROLLING_DATE_WINDOW_REPORT", status: "PARTIAL", historicalComplete: false, officialMaximumWindowDays: 60, historyWindow: "LATEST_REQUESTED_60_CLOSED_DAYS", missingCapabilities: ["HISTORY_BEYOND_OFFICIAL_60_DAY_REQUEST_WINDOW", "LATE_RETURN_RECONCILIATION"], incrementalStrategy: "DAILY_REFRESH_LATEST_ROLLING_60_DAY_WINDOW_KEEP_REPORT_VERSIONS", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", rawMayContainPii: true, structuredFieldsContainLabelTrackingAndAddresses: false } : {};
  const cursor = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    const old = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (old && (old.resource !== resource || old.amazonSellerId !== source.authorization.amazonSellerId || old.marketplaceId !== source.marketplaceId || old.organizationId !== scope.organizationId || old.workspaceId !== scope.workspaceId)) throw new SyncInputError("报告游标身份不匹配。", 403);
    const reportWindow = (run.frozenScope as { reportWindow?: { createdSince?: string; createdUntil?: string } }).reportWindow;
    if (domainHistoryReplay) {
      const replayWindow = reportDataWindow!;
    if (!old || old.status !== "SUCCEEDED" || historyCursorDigest !== domainReportHistoryCursorDigest(old) || Date.parse(replayWindow.dataEndTime) > old.watermarkTo.getTime()) throw new SyncInputError("报告历史补采不匹配已完成的前向游标或窗口。", 409);
      if (resource === "inventory_events") {
        const owner = old.activeRunId ? await tx.amazonSyncRun.findFirst({ where: { ...scope, id: old.activeRunId, sourceId: source.id }, select: { frozenScope: true } }) : null;
        const ownerWindow = (owner?.frozenScope as { reportWindow?: { eventType?: unknown } } | null)?.reportWindow;
        if (!ownerWindow || ownerWindow.eventType !== inventoryEventWindow?.eventType) throw new SyncInputError("库存事件历史补采筛选器与前向任务不一致。", 409);
      }
      return old;
    }
    const starting = !old || old.status === "SUCCEEDED";
    if (old && !starting && inventoryEventWindow) {
      if (old.watermarkFrom.getTime() !== Date.parse(inventoryEventWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(inventoryEventWindow.dataEndTime)) throw new SyncInputError("库存事件窗口与未完成游标不匹配；保留原件及检查点。", 409);
      const owner = old.activeRunId ? await tx.amazonSyncRun.findFirst({ where: { ...scope, id: old.activeRunId, sourceId: source.id }, select: { frozenScope: true } }) : null;
      const original = (owner?.frozenScope as { reportWindow?: { eventType?: unknown } } | null)?.reportWindow;
      if (!original || original.eventType !== inventoryEventWindow.eventType) throw new SyncInputError("库存事件类型与原报告不一致，禁止用不同筛选范围接管未完成游标。", 409);
    }
    if (old && !starting && reimbursementWindow && (old.watermarkFrom.getTime() !== Date.parse(reimbursementWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(reimbursementWindow.dataEndTime))) throw new SyncInputError("赔偿窗口与未完成报告游标不匹配；保留原报告，须单独核对后恢复。", 409);
    if (old && !starting && removalOrderWindow && (old.watermarkFrom.getTime() !== Date.parse(removalOrderWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(removalOrderWindow.dataEndTime))) throw new SyncInputError("移除报告日期与未完成报告游标不匹配；保留原报告及检查点。", 409);
    if (old && !starting && fbaShipmentsWindow && (old.watermarkFrom.getTime() !== Date.parse(fbaShipmentsWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(fbaShipmentsWindow.dataEndTime))) throw new SyncInputError("FBA 发货报告窗口与未完成游标不匹配；保留原报告及检查点。", 409);
    if (old && !starting && mfnReturnsWindow && (old.watermarkFrom.getTime() !== Date.parse(mfnReturnsWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(mfnReturnsWindow.dataEndTime))) throw new SyncInputError("MFN 退货报告窗口与未完成游标不匹配；保留原报告及检查点。", 409);
    if (old && !starting && storageFeeWindow && (old.watermarkFrom.getTime() !== Date.parse(storageFeeWindow.dataStartTime) || old.watermarkTo.getTime() !== Date.parse(storageFeeWindow.dataEndTime))) throw new SyncInputError("长期仓储费月份与未完成报告游标不匹配；保留原报告及检查点。", 409);
    if (old && !starting && resource === "settlements" && (old.watermarkFrom.toISOString() !== reportWindow?.createdSince || old.watermarkTo.toISOString() !== reportWindow?.createdUntil)) throw new SyncInputError("结算发现窗口与未完成游标不匹配。", 409);
    const create = {
      ...scope,
      id: randomUUID(),
      sourceId: source.id,
      resource,
      amazonSellerId: source.authorization.amazonSellerId,
      marketplaceId: source.marketplaceId,
      watermarkFrom: new Date(discoveryWindow?.createdSince ?? reportDataWindow?.dataStartTime ?? now()),
      watermarkTo: new Date(discoveryWindow?.createdUntil ?? reportDataWindow?.dataEndTime ?? now()),
      status: "RUNNING",
      activeRunId: run.id,
    } as const;
    const update = {
      activeRunId: run.id,
      status: "RUNNING",
      ...(starting ? {
        watermarkFrom: new Date(discoveryWindow?.createdSince ?? reportDataWindow?.dataStartTime ?? now()),
        watermarkTo: new Date(discoveryWindow?.createdUntil ?? reportDataWindow?.dataEndTime ?? now()),
        reportStateCiphertext: null,
      } : {}),
    };
    return tx.amazonSyncResourceCursor.upsert({ where: { sourceId: source.id }, create, update });
  });
  if (domainHistoryReplay && (cursor.status !== "SUCCEEDED" || domainReportHistoryCursorDigest(cursor) !== historyCursorDigest)) {
    throw new SyncInputError("历史补采期间前向游标发生变化；补采不匹配已完成的前向游标或窗口，需重新规划缺口。", 409);
  }
  const stateCiphertext = domainHistoryReplay ? run.checkpointCiphertext : cursor.reportStateCiphertext;
  const stateOwnerId = domainHistoryReplay ? run.id : cursor.id;
  const state: DomainReportState = stateCiphertext ? JSON.parse(decryptCheckpoint(stateCiphertext, scope, stateOwnerId) ?? "{}") : {};
  const assertReplayCursor = async (tx: Prisma.TransactionClient) => {
    if (!domainHistoryReplay) return;
    const live = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (live.status !== "SUCCEEDED" || domainReportHistoryCursorDigest(live) !== historyCursorDigest) {
      throw new SyncInputError("历史补采期间前向游标发生变化；补采已停止，需重新规划缺口。", 409);
    }
  };
  const operation = resource === "settlements" && !state.reportId || state.creating ? "getReports" : !state.reportId ? "createReport" : !state.documentId ? "getReport" : "getReportDocument";
  const budgetKey = { ...scope, authorizationId: source.authorization.id, operation };
  const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
  // Seller settlement archives use their own durable owner/raw references.
  // Parsing or projecting an existing original consumes no Amazon request.
  if (!state.archiveTaskId && !(settlement && state.documentId) && budget && budget.nextRequestAt > now()) { await yieldSlice(run, budget.nextRequestAt); return; }
  const saveState = async (stage: string, status: "WAITING" | "SUCCEEDED" = "WAITING", nextAttemptAt = now()) => {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      await assertReplayCursor(tx);
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
      if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING", ...(status === "SUCCEEDED" ? { lastSuccessAt: now() } : {}) } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status, stage, finishedAt: status === "SUCCEEDED" ? now() : null, nextAttemptAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 }, ...(status === "SUCCEEDED" ? { paginationComplete: true } : {}) } });
      await log(tx, run, stage);
    });
  };
  const saveProgress = async (stage: string) => prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return true;
    await assertReplayCursor(tx);
    const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
    if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, stage, leaseExpiresAt: new Date(now().getTime() + leaseMs) } });
    await log(tx, run, stage);
    return false;
  });
  const record = async (error?: unknown) => persistRequests(run, events, budgetKey, error);
  if (resource === "settlements" && !state.reportId) {
    assertSettlementDiscoveryAvailable(discoveryWindow!, now());
    const response = await client.getReports({ reportType: domainReportTypes.settlements, marketplaceId: source.marketplaceId, ...discoveryWindow!, ...(state.discoveryToken ? { nextToken: state.discoveryToken } : {}) }).catch(async e => { await record(e); throw e; });
    await record();
    const page = parseGetReportsPage(response, domainReportTypes.settlements, source.marketplaceId, settlement?.policy.collectionMarketplaceIds);
    const discovered = [...new Map([...(state.reportIds ?? []), ...page.reports].map(item => [item.reportId, item])).values()];
    if (discovered.length > 1000) throw new SyncInputError("结算报告超过单任务 1000 份上限；缩小报告创建时间窗口后重新申请。", 409);
    state.reportIds = discovered;
    if (page.nextToken) { state.discoveryToken = page.nextToken; await saveState("SETTLEMENT_DISCOVERY"); return; }
    if (!state.reportIds.length) {
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        const capturedAt = now(), cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
        await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, status: "SUCCEEDED", lastSuccessAt: capturedAt } });
        await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: 0, coverage: { type: "report_discovery", reportType: domainReportTypes.settlements, reportCount: 0, createdSince: discoveryWindow!.createdSince, createdUntil: discoveryWindow!.createdUntil, ...(discoveryWindow!.retentionGap ? { retentionGap: discoveryWindow!.retentionGap, historicalComplete: false } : {}), capturedAt: capturedAt.toISOString() } } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "SUCCEEDED", stage: "COMPLETED", finishedAt: capturedAt, paginationComplete: true, summary: { coverage: { reportType: domainReportTypes.settlements, reportCount: 0, discoveryOnly: true, window: discoveryWindow, historicalComplete: false } }, leaseOwner: null, leaseExpiresAt: null } });
        await log(tx, run, "SETTLEMENT_DISCOVERY_EMPTY");
      });
      return;
    }
    state.reportIndex = 0; state.reportId = state.reportIds[0].reportId; state.reportCreatedAt = state.reportIds[0].createdTime;
    await saveState("SETTLEMENT_REPORT_SELECTED"); return;
  }
  if (resource !== "settlements" && !state.reportId) {
    if (state.creating) {
      const requestedAt = Date.parse(state.requestedAt ?? "");
      if (!Number.isFinite(requestedAt)) throw new SyncInputError("报告创建检查点缺少申请时间；禁止重复创建。", 409);
      const response = await client.getReports({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, createdSince: new Date(requestedAt - 5_000).toISOString(), createdUntil: now().toISOString(), ...(state.reconcileToken ? { nextToken: state.reconcileToken } : {}) }).catch(async e => { await record(e); throw e; });
      await record();
      const page = parseGetReportsPage(response, domainReportTypes[resource], source.marketplaceId);
      const candidates = [...new Map([...(state.reconcileCandidates ?? []), ...page.reports.filter(item => item.createdTime !== null && Date.parse(item.createdTime) >= requestedAt - 5_000)].map(item => [item.reportId, item])).values()];
      if (candidates.length > 100) throw new SyncInputError("Amazon 报告创建核对结果超过容量上限；已停止自动处理。", 409);
      state.reconcileCandidates = candidates;
      if (page.nextToken) { state.reconcileToken = page.nextToken; await saveState("REPORT_CREATE_RECONCILING"); return; }
      delete state.reconcileToken;
      if (candidates.length > 1) throw new SyncInputError("报告申请时间范围内存在多个候选报告，无法安全确认本任务的报告；请人工核对。", 409);
      if (candidates.length === 1) {
        state.reportId = candidates[0].reportId;
        state.reportCreatedAt = candidates[0].createdTime;
        state.creating = false;
        delete state.reconcileCandidates;
        state.polls = 0;
        await saveState("REPORT_CREATE_RECONCILED"); return;
      }
      state.polls = (state.polls ?? 0) + 1;
      if (state.polls >= 100 || now().getTime() - requestedAt > 24 * 60 * 60_000) throw new SyncInputError("Amazon 尚未提供可核對的報告記錄；為避免重複建立，已停止自動重試。", 409);
      await saveState("REPORT_CREATE_RECONCILING", "WAITING", new Date(now().getTime() + 60_000)); return;
    }
    if (resource === "reimbursements" && !reimbursementWindow) throw new SyncInputError("旧赔偿任务无冻结日期窗口，须保留原任务并重新申请明确窗口；禁止创建无界报告。", 409);
    if (isRemovalReport(resource) && !removalOrderWindow) throw new SyncInputError("旧移除报告任务无冻结日期窗口；禁止创建无界报告。", 409);
    if (resource === "fba_shipments" && !fbaShipmentsWindow) throw new SyncInputError("FBA 发货报告任务缺少冻结日期窗口；禁止创建无界报告。", 409);
    if (resource === "mfn_returns" && !mfnReturnsWindow) throw new SyncInputError("MFN 退货报告缺少冻结日期窗口；禁止创建无界报告。", 409);
    if (resource === "long_term_storage_fees" && !storageFeeWindow) throw new SyncInputError("长期仓储费报告必须冻结完整月窗口；禁止创建无界报告。", 409);
    if (resource === "fee_preview" && !state.creating) {
      const eligibleSources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: source.authorization.id, resource, enabled: true }, orderBy: { marketplaceId: "asc" }, select: { marketplaceId: true } });
      const turn = eligibleSources.length ? Math.floor(now().getTime() / 86_400_000) % eligibleSources.length : 0;
      const gateKey = { ...scope, authorizationId: source.authorization.id, operation: "feePreviewDaily" };
      if (eligibleSources[turn]?.marketplaceId !== source.marketplaceId) {
        const tomorrowUtc = new Date((Math.floor(now().getTime() / 86_400_000) + 1) * 86_400_000);
        const sellerBudget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: gateKey }, select: { nextRequestAt: true } });
        await yieldSlice(run, sellerBudget && sellerBudget.nextRequestAt > tomorrowUtc ? sellerBudget.nextRequestAt : tomorrowUtc);
        return;
      }
      const sellerGate = digest(["feePreviewDaily", source.authorization.amazonSellerId]);
      const nextAt = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sellerGate}, 0))`;
        const old = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: gateKey } });
        if (old && old.nextRequestAt > now()) return old.nextRequestAt;
        const requestedAt = now();
        const dataEndTime = requestedAt.toISOString();
        state.feePreviewWindow = { dataStartTime: new Date(requestedAt.getTime() - 72 * 60 * 60_000).toISOString(), dataEndTime };
        await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: gateKey }, create: { ...gateKey, nextRequestAt: new Date(requestedAt.getTime() + 24 * 60 * 60_000) }, update: { nextRequestAt: new Date(requestedAt.getTime() + 24 * 60 * 60_000) } });
        return null;
      });
      if (nextAt) { await yieldSlice(run, nextAt); return; }
    }
    state.creating = true; state.requestedAt = now().toISOString(); state.polls = 0; state.reconcileCandidates = [];
    if (await saveProgress("REPORT_CREATING")) return;
    let response;
    try {
      response = resource === "inventory_events"
        ? await client.createInventoryLedgerReport({ marketplaceId: source.marketplaceId, from: inventoryEventWindow!.dataStartTime, to: inventoryEventWindow!.dataEndTime, eventType: inventoryEventWindow!.eventType })
        : resource === "reimbursements"
          ? await client.createReport({ reportType: domainReportTypes.reimbursements, marketplaceId: source.marketplaceId, from: reimbursementWindow!.dataStartTime, to: reimbursementWindow!.dataEndTime })
          : storageFeeWindow
            ? await client.createReport({ reportType: domainReportTypes.long_term_storage_fees, marketplaceId: source.marketplaceId, from: storageFeeWindow.dataStartTime, to: storageFeeWindow.dataEndTime })
          : isRemovalReport(resource)
            ? await client.createReport({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, from: removalOrderWindow!.dataStartTime, to: removalOrderWindow!.dataEndTime })
          : fbaShipmentsWindow
            ? await client.createReport({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, from: fbaShipmentsWindow.dataStartTime, to: fbaShipmentsWindow.dataEndTime })
          : mfnReturnsWindow
            ? await client.createReport({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, from: mfnReturnsWindow.dataStartTime, to: mfnReturnsWindow.dataEndTime })
          : resource === "fee_preview"
            ? await client.createReport({ reportType: domainReportTypes.fee_preview, marketplaceId: source.marketplaceId, from: state.feePreviewWindow!.dataStartTime, to: state.feePreviewWindow!.dataEndTime })
            : await client.createSnapshotReport({ reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId });
    }
    catch (e) {
      await record(e);
      if (e instanceof AmazonSpApiError && e.status !== null && e.status >= 400 && e.status < 500 && e.status !== 408) {
        state.creating = false; delete state.requestedAt; state.polls = 0;
        await saveProgress("REPORT_CREATE_REJECTED");
      }
      throw e;
    }
    await record();
    const reportId = (response as { reportId?: unknown })?.reportId;
    if (typeof reportId !== "string" || !reportId || reportId.length > 200) throw new SyncInputError("Amazon 报告未返回有效 reportId。", 422);
    state.reportId = reportId; state.creating = false; state.polls = 0; await saveState("REPORT_POLLING", "WAITING", new Date(now().getTime() + 60_000)); return;
  }
  if (!state.documentId) {
    const report = await client.getReport(state.reportId!).catch(async e => { await record(e); throw e; }); await record();
    const data = report as { reportId?: unknown; reportType?: unknown; marketplaceIds?: unknown; processingStatus?: unknown; reportDocumentId?: unknown; createdTime?: unknown };
    if (data.reportId !== state.reportId || data.reportType !== domainReportTypes[resource]) throw new SyncInputError("Amazon 报告身份与任务范围不一致。", 422);
    if (settlement) state.marketplaceIds = assertSettlementMarketplaces(data.marketplaceIds, settlement.policy, source.marketplaceId);
    else if (!Array.isArray(data.marketplaceIds) || data.marketplaceIds.length !== 1 || data.marketplaceIds[0] !== source.marketplaceId) throw new SyncInputError("Amazon 报告站点与任务范围不一致。", 422);
    if (resource === "inventory_events" && inventoryEventWindow) {
      const ledger = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((ledger.dataStartTime !== undefined && Date.parse(String(ledger.dataStartTime)) !== Date.parse(inventoryEventWindow.dataStartTime)) || (ledger.dataEndTime !== undefined && Date.parse(String(ledger.dataEndTime)) !== Date.parse(inventoryEventWindow.dataEndTime))) throw new SyncInputError("库存事件报告日期与审批范围不一致。", 422);
    }
    if (reimbursementWindow) {
      const dates = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((dates.dataStartTime !== undefined && !reportTimestampMatches(dates.dataStartTime, reimbursementWindow.dataStartTime)) || (dates.dataEndTime !== undefined && !reportTimestampMatches(dates.dataEndTime, reimbursementWindow.dataEndTime))) throw new SyncInputError("赔偿报告日期与冻结窗口不一致。", 422);
    }
    if (removalOrderWindow) {
      const dates = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((dates.dataStartTime !== undefined && !reportTimestampMatches(dates.dataStartTime, removalOrderWindow.dataStartTime)) || (dates.dataEndTime !== undefined && !reportTimestampMatches(dates.dataEndTime, removalOrderWindow.dataEndTime))) throw new SyncInputError("移除报告日期与冻结窗口不一致。", 422);
    }
    if (fbaShipmentsWindow) {
      const dates = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((dates.dataStartTime !== undefined && !reportTimestampMatches(dates.dataStartTime, fbaShipmentsWindow.dataStartTime)) || (dates.dataEndTime !== undefined && !reportTimestampMatches(dates.dataEndTime, fbaShipmentsWindow.dataEndTime))) throw new SyncInputError("FBA 发货报告日期与冻结窗口不一致。", 422);
    }
    if (storageFeeWindow) {
      const dates = report as { dataStartTime?: unknown; dataEndTime?: unknown };
      if ((dates.dataStartTime !== undefined && !reportTimestampMatches(dates.dataStartTime, storageFeeWindow.dataStartTime)) || (dates.dataEndTime !== undefined && !reportTimestampMatches(dates.dataEndTime, storageFeeWindow.dataEndTime))) throw new SyncInputError("长期仓储费报告月份与冻结窗口不一致。", 422);
    }
    if (data.createdTime !== undefined && (typeof data.createdTime !== "string" || !Number.isFinite(Date.parse(data.createdTime)))) throw new SyncInputError("Amazon 报告创建时间无效。", 422);
    if (typeof data.createdTime === "string") state.reportCreatedAt = new Date(data.createdTime).toISOString();
    if (["IN_QUEUE", "IN_PROGRESS"].includes(String(data.processingStatus))) { state.polls = (state.polls ?? 0) + 1; if (state.polls > 100) throw new SyncInputError("报告轮询达到上限，请人工检查后重新申请。", 409); await saveState("REPORT_POLLING", "WAITING", new Date(now().getTime() + 60_000)); return; }
    assertDomainReportReady(data.processingStatus, data.reportDocumentId);
    state.documentId = data.reportDocumentId as string; await saveState("REPORT_DOWNLOADING"); return;
  }
  if (settlement && state.documentId) {
    await executeSettlementSlice({ run, client, events, now, scope, source, state, documentId: state.documentId, cursor, settlement, discoveryWindow, budgetKey, budget, record, saveState });
    return;
  }
  if (!state.archiveTaskId) {
    const document = await client.getReportDocument(state.documentId).catch(async e => { await record(e); throw e; }); await record();
    let text: string;
    try { text = await client.downloadReportText(document); } catch (e) { await record(e); throw e; }
    await record();
    // Preserve even a parser-rejected report. The following slice validates
    // the full encrypted original before committing structured report rows.
    const rawPage = Math.max(run.pagesCompleted + 1, 1);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      await assertReplayCursor(tx);
        await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: rawPage, resource, requestMetadata: { apiVersion: "2021-06-30", operation: "getReportDocument", reportId: state.reportId, documentId: state.documentId, reportCreatedAt: state.reportCreatedAt ?? null, reportType: domainReportTypes[resource], marketplaceId: source.marketplaceId, ...(resource === "inventory_events" || isRemovalReport(resource) || resource === "fba_shipments" || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" ? { reportWindow: window } : {}), rawMayContainPii: true }, rawCiphertext: seal(rawReportEnvelope(text), scope, `${run.id}:${rawPage}`, `amazon-${resource}-raw.v1`), bodySha256: createHash("sha256").update(text).digest("hex"), capturedAt: now() } });
      await registerArchivedFields(tx, run, rawPage, text, "REPORT");
      state.archiveTaskId = run.id; state.archivePage = rawPage; state.offset = 0;
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage, phase: "ARCHIVED", rowsCommitted: 0, checkedAt: now() });
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
      if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, status: "WAITING", stage: "REPORT_PARSING", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    });
    return;
  }
  const archive = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: state.archiveTaskId, page: state.archivePage, resource, task: { sourceId: source.id } } });
  if (!archive) throw new SyncInputError("报告密文原件缺失，无法解析。", 409);
  const raw = unseal(archive.rawCiphertext, scope, `${archive.taskId}:${archive.page}`, `amazon-${resource}-raw.v1`) as { rawText: string };
  if (createHash("sha256").update(raw.rawText).digest("hex") !== archive.bodySha256) throw new SyncInputError("报告原件摘要校验失败。", 409);
  const offset = state.offset ?? 0, parsed = parseDomainReport(resource, raw.rawText, { offset, limit: 500, ...(inventoryEventWindow ? { inventoryEventWindow } : {}), ...(reimbursementWindow ? { reimbursementWindow } : {}), ...(removalOrderWindow ? { removalOrderWindow } : {}), ...(fbaShipmentsWindow ? { fbaShipmentsWindow } : {}), ...(mfnReturnsWindow ? { mfnReturnsWindow } : {}), ...(storageFeeWindow ? { storageFeeWindow } : {}) }), batch = parsed.rows;
  state.rows = parsed.rowCount;
  if (!state.documentSaved) {
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      await assertReplayCursor(tx);
      const id = digest([scope, source.id, state.reportId]);
      const prior = await tx.amazonSyncReportDocument.findUnique({ where: { organizationId_workspaceId_sourceId_reportId: { ...scope, sourceId: source.id, reportId: state.reportId! } } });
      if (prior && prior.contentSha256 !== archive.bodySha256) throw new SyncInputError("相同 Amazon reportId 返回了不同内容摘要；拒绝覆盖已归档报告。", 409);
      await tx.amazonSyncReportDocument.createMany({ data: [{ id, ...scope, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, resource, reportType: domainReportTypes[resource], reportId: state.reportId!, reportCreatedAt: state.reportCreatedAt ? new Date(state.reportCreatedAt) : null, businessDateField: parsed.dateField, rowCount: parsed.rowCount, contentSha256: archive.bodySha256, status: "STAGED", capturedAt: now() }], skipDuplicates: true });
      state.documentSaved = true;
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
      if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, status: "WAITING", stage: "REPORT_PARSING", nextAttemptAt: now(), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    });
    return;
  }
  const documentId = digest([scope, source.id, state.reportId]);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    await assertReplayCursor(tx);
    const guarded = ["inventory_events", "reimbursements"].includes(resource);
    const attributed = guarded ? await markReportRowAttribution(tx, scope, source, batch) : batch;
    const inserted = await tx.amazonSyncReportRow.createMany({ data: attributed.map(row => ({ id: digest([documentId, row.rowNumber]), ...scope, sourceId: source.id, reportDocumentId: documentId, reportId: state.reportId!, ...row, fields: row.fields as Prisma.InputJsonValue })), skipDuplicates: true });
    if (guarded) await persistReportAttributionMarkers(tx, scope, source.id, documentId, attributed);
    if (!archivePolicy && resource !== "settlements" && !isInventoryReport(resource)) {
      const persistence = await recordDomainReportFieldPersistence(tx, scope, run.requestedByUserId, {
        sourceId: source.id, resource, reportDocumentId: documentId, rawTaskId: archive.taskId, rawPage: archive.page, rows: attributed,
      });
      if (!persistence.passed) throw new SyncInputError("REPORT_FIELD_PERSISTENCE_MISMATCH：报告字段回读不一致，停止发布并保留原件。", 409);
    }
    if (isInventoryReport(resource) || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" || isRemovalReport(resource)) {
      const stored = await tx.amazonSyncReportRow.findMany({ where: { ...scope, sourceId: source.id, reportDocumentId: documentId, rowNumber: { in: batch.map(row => row.rowNumber) } }, select: { rowNumber: true, rowHash: true, fields: true } });
      if (stored.length !== batch.length || batch.some(row => !stored.some(actual => actual.rowNumber === row.rowNumber && actual.rowHash === row.rowHash && digest(actual.fields) === digest(row.fields)))) throw new SyncInputError("REPORT_FIELD_PERSISTENCE_MISMATCH：库存报告字段回读不一致，停止发布并保留原件。", 409);
    }
    state.offset = offset + batch.length;
    state.totalRows = (state.totalRows ?? 0) + batch.length;
    const complete = state.offset >= parsed.rowCount;
    const verifiedInDocument = complete && guarded ? await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, reportDocumentId: documentId, ...reportVerifiedRowWhere(resource, source.marketplaceId) } }) : parsed.rowCount;
    await recordReportParseEvidence(tx, run, { rawTaskId: archive.taskId, rawPage: archive.page,
      phase: !complete ? "ROWS_COMMITTED" : archivePolicy ? "PARSED_SITE_PENDING" : guarded && verifiedInDocument !== parsed.rowCount ? "ATTRIBUTION_PENDING" : "PUBLISHED",
      rowsCommitted: state.offset, totalRows: parsed.rowCount, checkedAt: now() });
    if (complete) {
      const missingCurrency = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, reportDocumentId: documentId, amountOriginal: { not: null }, currencyCode: null } });
      await recordReportQualityIssue(tx, scope, run.requestedByUserId, { sourceId: source.id, taskId: run.id, reportId: state.reportId!, code: "CURRENCY_MISSING", affectedRows: missingCurrency, affectedFields: ["currencyCode"], from: reportDataWindow?.from, to: reportDataWindow?.to, rawSha256: archive.bodySha256, checkedAt: now() });
      if (guarded) {
        const verified = verifiedInDocument;
        await recordReportQualityIssue(tx, scope, run.requestedByUserId, { sourceId: source.id, taskId: run.id, reportId: state.reportId!, code: "SKU_ATTRIBUTION_PENDING", affectedRows: parsed.rowCount - verified, affectedFields: ["marketplaceId", "sellerSku", "asin"], from: reportDataWindow?.from, to: reportDataWindow?.to, rawSha256: archive.bodySha256, checkedAt: now() });
      }
    }
    if (complete && archivePolicy) {
      await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "STAGED", publishedAt: null } });
      const cipher = encryptCheckpoint(JSON.stringify(state), scope, cursor.id);
      // Collection may advance independently. Never write a site success watermark.
      await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: "SUCCEEDED", reportStateCiphertext: cipher } });
      const prior = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
      const quality = { status: "ARCHIVED_SITE_PENDING", code: "SITE_ATTRIBUTION_NOT_APPLIED", rawArchived: true, parseComplete: true, parsedRows: parsed.rowCount, publishedRows: 0, siteScopedRows: 0, publishable: false };
      const archiveCollection = { mode: archivePolicy.mode, status: "ARCHIVED_SITE_PENDING", lastCompletedAt: now().toISOString(), from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString(), reportId: state.reportId!, documentId, rows: parsed.rowCount, published: false, historicalComplete: false, quality };
      await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { coverage: { ...prior, quality, archiveCollection } } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "ARCHIVED_SITE_PENDING", checkpointCiphertext: cipher, finishedAt: now(), paginationComplete: true, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, summary: { quality, archiveCollection }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
      await persistWindowCheckpoints(tx, run, now());
      await log(tx, run, "SELLER_REPORT_ARCHIVED");
      return;
    }
    if (complete && guarded) {
      const visibleRows = verifiedInDocument;
      if (visibleRows !== parsed.rowCount) {
        await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "STAGED" } });
        const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
        if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: "BLOCKED", reportStateCiphertext: cipher } });
        const priorCoverage = source.coverage && typeof source.coverage === "object" && !Array.isArray(source.coverage) ? source.coverage : {};
        const quality = { status: "BLOCKED", code: "REPORT_ROW_ATTRIBUTION_PENDING", rawArchived: true, parseComplete: true, parsedRows: parsed.rowCount, verifiedRows: visibleRows, quarantinedRows: parsed.rowCount - visibleRows, publishable: false };
        if (!domainHistoryReplay) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { coverage: { ...priorCoverage, quality, quarantinedRows: parsed.rowCount - visibleRows, historicalComplete: false, rowAttribution: { status: "PENDING_VERIFICATION", version: "explicit-report-row.v1", verifiedRows: visibleRows, parsedRows: parsed.rowCount, complete: false } } } });
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "BLOCKED", stage: "REPORT_ATTRIBUTION_PENDING", error: "REPORT_ROW_ATTRIBUTION_PENDING：报告行归属未完全证实；原件及明细保留，未发布站点事实。", summary: { quality }, checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, dispatchVersion: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
        await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: run.requestedByUserId, action: "amazon.sync.report.attribution-blocked", entityType: "AmazonSyncRun", entityId: run.id, metadata: { workspaceId: scope.workspaceId, sourceId: source.id, resource, parsedRows: parsed.rowCount, verifiedRows: visibleRows, originalPreserved: true } } });
        return;
      }
    }
    if (complete && (isInventoryReport(resource) || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" || isRemovalReport(resource))) {
      const count = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, reportDocumentId: documentId } });
      if (count !== parsed.rowCount) throw new SyncInputError("INVENTORY_REPORT_COUNT_MISMATCH：结构化行数不等于完整原件，停止发布。", 409);
    }
    if (complete) await tx.amazonSyncReportDocument.update({ where: { id: documentId }, data: { status: "PUBLISHED", publishedAt: now() } });
    const nextReport = complete && resource === "settlements" ? state.reportIds?.[(state.reportIndex ?? 0) + 1] : undefined;
    if (nextReport) {
      state.reportIndex = (state.reportIndex ?? 0) + 1; state.reportId = nextReport.reportId; state.reportCreatedAt = nextReport.createdTime;
      delete state.documentId; delete state.archiveTaskId; delete state.archivePage; delete state.offset; delete state.rows; delete state.documentSaved;
      state.polls = 0;
    }
    const finished = complete && !nextReport;
    const totalProcessed = state.totalRows;
    const totalInserted = run.insertedCount + inserted.count;
    await assertReplayCursor(tx);
    const cipher = encryptCheckpoint(JSON.stringify(state), scope, stateOwnerId);
    if (!domainHistoryReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { reportStateCiphertext: cipher, ...(finished ? { status: "SUCCEEDED", lastSuccessAt: now() } : { status: "RUNNING" }) } });
    const quality = finished && guarded ? { status: "PASSED", code: "REPORT_PUBLISHED", rawArchived: true, parseComplete: true, attributionComplete: true, parsedRows: totalProcessed, publishedRows: totalProcessed, quarantinedRows: 0, publishable: true } : undefined;
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext: cipher, pagesCompleted: { increment: 1 }, processedCount: { increment: batch.length }, insertedCount: { increment: inserted.count }, status: finished ? "SUCCEEDED" : "WAITING", stage: finished ? "COMPLETED" : nextReport ? "SETTLEMENT_NEXT_REPORT" : "REPORT_PARSING", finishedAt: finished ? now() : null, paginationComplete: finished, summary: finished ? { ...(quality ? { quality } : {}), coverage: { ...storageFeeCoverage, ...inventoryOverageCoverage, reportType: domainReportTypes[resource], reportIds: resource === "settlements" ? (state.reportIds ?? []).map(item => item.reportId) : [state.reportId!], rows: totalProcessed, insertedRows: totalInserted, businessDateField: parsed.dateField, ...(resource === "inventory_events" || resource === "reimbursements" ? { complete: true, transportComplete: true, attributionComplete: true } : {}), ...(discoveryWindow ? { discoveryWindow, historicalComplete: false } : {}), ...(reimbursementWindow ? { reimbursementWindow, historicalComplete: false } : {}), ...(removalOrderWindow ? { removalOrderWindow, historicalComplete: false, historyStart: "FIRST_AUTOMATIC_CLOSED_DAY_ONLY" } : {}), ...(fbaShipmentsWindow ? { fbaShipmentsWindow, type: "WINDOWED_REPORT", status: "PARTIAL", historicalComplete: false, officialMaximumWindowDays: 30, delaySafetyMarginHours: 24, officialRetentionDays: null, missingCapabilities: ["OFFICIAL_HISTORY_RETENTION_POLICY", "LATE_SHIPMENT_RECONCILIATION"], incrementalStrategy: "DAILY_ROLLING_30_CLOSED_UTC_DAYS_LATEST_WINDOW_ONLY", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", rawMayContainPii: true, structuredFieldsContainPii: false } : {}), ...(resource === "removal_shipment_report" ? { status: "PARTIAL", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", missingCapabilities: ["HISTORY_RETENTION_POLICY", "REQUEST_DATE_FILTER_VERIFICATION", "LATE_SHIPMENT_RECONCILIATION"], historyReason: "RETENTION_AND_REQUEST_DATE_FILTER_UNCONFIRMED", incrementalStrategy: "DAILY_CLOSED_UTC_REQUEST_WINDOW", excludedData: ["CANCELLED_RETURNS", "DISPOSED_ITEMS"] } : {}), dateMeaning: resource === "inventory_age" ? "snapshot; not historical inventory" : parsed.dateField } } : undefined, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    if (finished) {
      const publishedRowCount = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, ...(["fba_shipments", "fba_customer_sales", "mfn_returns"].includes(resource) ? { reportDocumentId: documentId } : {}), document: { status: "PUBLISHED", resource }, ...reportVerifiedRowWhere(resource, source.marketplaceId) } });
      const allRows = await tx.amazonSyncReportRow.count({ where: { ...scope, sourceId: source.id, document: { status: "PUBLISHED", resource } } });
      if (!domainHistoryReplay) await tx.amazonSyncDataSource.update({
        where: { id: source.id },
        data: {
          activeRunId: run.id,
          lastSuccessAt: now(),
          rowCount: isInventoryReport(resource) || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" ? parsed.rowCount : publishedRowCount,
          coverage: {
            ...storageFeeCoverage,
            reportType: domainReportTypes[resource],
            reportIds: resource === "settlements" ? (state.reportIds ?? []).map(item => item.reportId) : [state.reportId!],
            rowCount: isInventoryReport(resource) || resource === "fba_customer_sales" || resource === "mfn_returns" || resource === "long_term_storage_fees" ? parsed.rowCount : publishedRowCount,
            ...(isInventoryReport(resource) ? { type: "snapshot", historyApplicable: false, historicalComplete: false, historyReason: "API_CURRENT_SNAPSHOT_ONLY", parserVersion: inventoryReportParserVersion, rawArchived: true, parsed: true, validated: true, published: true, incrementalStrategy: resource === "fee_preview" ? "ONE_SELLER_REQUEST_PER_24_HOURS_KEEP_PUBLISHED_SNAPSHOTS" : resource === "fba_overage_fees" ? "DAILY_ON_DEMAND_ESTIMATE_SNAPSHOT_KEEP_VERSIONS" : resource === "recommended_removals" ? "DAILY_SNAPSHOT_REPLACE_HEAD_KEEP_VERSIONS" : "HOURLY_SNAPSHOT_REPLACE_HEAD_KEEP_VERSIONS", quality: { status: "PASSED", rawArchived: true, parseComplete: true, parsedRows: parsed.rowCount, publishable: true } } : {}),
            ...(guarded ? { quality, quarantinedRows: allRows - publishedRowCount, attributionPolicy: "verified-site-v2", historicalComplete: false } : {}),
            capturedAt: now().toISOString(),
            businessDateField: parsed.dateField,
            ...(requiresReportRowAttribution(resource) ? { rowAttribution: { status: "VERIFIED", version: "explicit-report-row.v1", complete: true } } : {}),
            ...(discoveryWindow ? { discoveryWindow, historicalComplete: false } : {}),
            ...(reimbursementWindow ? { reimbursementWindow, historicalComplete: false } : {}),
            ...(removalOrderWindow ? { removalOrderWindow, historicalComplete: false, historyStart: "FIRST_AUTOMATIC_CLOSED_DAY_ONLY" } : {}), ...(resource === "removal_shipment_report" ? { status: "PARTIAL", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", missingCapabilities: ["HISTORY_RETENTION_POLICY", "REQUEST_DATE_FILTER_VERIFICATION", "LATE_SHIPMENT_RECONCILIATION"], historyReason: "RETENTION_AND_REQUEST_DATE_FILTER_UNCONFIRMED", incrementalStrategy: "DAILY_CLOSED_UTC_REQUEST_WINDOW", excludedData: ["CANCELLED_RETURNS", "DISPOSED_ITEMS"] } : {}),
            ...(fbaShipmentsWindow ? { fbaShipmentsWindow, type: "WINDOWED_REPORT", status: "PARTIAL", historicalComplete: false, officialMaximumWindowDays: 30, delaySafetyMarginHours: 24, officialRetentionDays: null, missingCapabilities: ["OFFICIAL_HISTORY_RETENTION_POLICY", "LATE_SHIPMENT_RECONCILIATION"], incrementalStrategy: "DAILY_ROLLING_30_CLOSED_UTC_DAYS_LATEST_WINDOW_ONLY", rawArchived: true, parsed: true, validated: true, published: true, parserVersion: "domain-reports.v2", rawMayContainPii: true, structuredFieldsContainPii: false } : {}),
          },
        },
      });
    }
    if (finished) await persistWindowCheckpoints(tx, run, now());
    await log(tx, run, finished ? "REPORT_PUBLISHED" : complete ? "REPORT_ROWS_COMMITTED" : "REPORT_ROWS_COMMITTED");
  });
};
}
