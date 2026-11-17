import { persistWindowCheckpoints } from "./window-checkpoints";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { archiveResponse, replayResponse } from "./response-evidence";
import { rawResponseEnvelope } from "./raw-fields";
import { continuityEvidence, continuityProbeDue } from "./continuity-access";
import { assertOrderRoles, orderCursorDigest, parseOrderDetail, type OrderSyncPolicy, type OrderWindow } from "./orders";
import { orderBucketKey, reserveOrderToken } from "./orders-rate-limit";
import { Prisma, type AmazonSyncRun, type AmazonSyncResourceCursor, type AmazonOrderDetailWork } from "@prisma/client";
import { AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { SyncInputError } from "./policy";
import { digest, seal } from "./approval-policy";
import type { SyncProcessorRuntime, SyncProcessorSource } from './processor-runtime';

export function createOrderDetailProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "maxPages" | "scopeLock" | "assertActor" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistOrderRequests" | "fenceLost">) {
  const { prisma, maxPages, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost } = runtime;
return async function executeOrderDetailSlice(run: AmazonSyncRun, source: SyncProcessorSource, policy: OrderSyncPolicy, window: OrderWindow, cursor: AmazonSyncResourceCursor, work: AmazonOrderDetailWork | null, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date, historyReplay = false) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const details = policy.details!;
  const bucketKey = orderBucketKey(source.authorization.amazonSellerId, policy.applicationId, "getOrder");
  let replayed = false;
  let response: Awaited<ReturnType<AmazonSpApiClient["getOrder"]>> | null = null;
  if (work) {
    await assertActor(run);
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) }); });
    const ordinal = maxPages + run.detailsCompletedCount + 1;
    const identity = { apiVersion: "2026-01-01", operation: "getOrder", orderId: work.amazonOrderId, listedUpdatedAt: work.listedUpdatedAt.toISOString(), includedData: details.includedData, policyDigest: digest(details), marketplaceId: source.marketplaceId };
    const archived = await replayResponse(run, ordinal, identity, prisma);
    if (archived !== null) {
      replayed = true;
      // Parsing an authenticated original makes no upstream request and must not
      // consume quota or wait for the next Amazon request slot.
      response = { rawBody: archived, body: JSON.parse(archived) };
    } else {
      const reservation = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run);
        const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) });
        if (await stopForControl(tx, run)) return null;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
        if (await continuityProbeDue(tx, live)) return { allowed: false, nextAt: new Date(now().getTime() + 5000) };
        const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
        const result = reserveOrderToken(bucket, details, now());
        await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: result.tokens, replenishedAt: result.replenishedAt }, update: { tokens: result.tokens, replenishedAt: result.replenishedAt } });
        return result;
      });
      if (!reservation) return;
      if (!reservation.allowed) { await yieldSlice(run, reservation.nextAt); return; }
      events.length = 0;
      try {
        await assertActor(run);
        await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) }); });
        response = await client.getOrder({ orderId: work.amazonOrderId, includedData: details.includedData });
        await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await archiveResponse(tx, run, ordinal, identity, response!.rawBody); });
      } catch (error) {
        await persistOrderRequests(run, events, bucketKey, details.requestsPerSecond, now(), error); throw error;
      }
      await persistOrderRequests(run, events, bucketKey, details.requestsPerSecond, now());
    }
  }
  const parsed = response && work ? parseOrderDetail(response.body, work.amazonOrderId, source.marketplaceId, policy, work.listedUpdatedAt) : null;
  const capturedAt = now(), policyDigest = digest(details);
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run); assertOrderRoles(live.authorization, policy, false, { ...scope, authorizationId: live.authorizationId, authorizationRevision: live.authorization.revision, marketplaceId: live.marketplaceId, currentEvidence: await continuityEvidence(tx, live) });
    if (await stopForControl(tx, run)) return;
    const currentCursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (historyReplay) {
      const expected = ((run.summary as Prisma.JsonObject | null)?.coverage ?? {}) as Prisma.JsonObject;
      const cursorDigest = orderCursorDigest(currentCursor);
      if (currentCursor.status !== "SUCCEEDED" || currentCursor.detailPolicyDigest !== policyDigest || cursorDigest !== expected.cursorDigest) throw fenceLost();
    } else if (currentCursor.activeRunId !== run.id || currentCursor.detailPolicyDigest !== policyDigest || currentCursor.watermarkFrom.toISOString() !== window.from || currentCursor.watermarkTo.toISOString() !== window.to || currentCursor.nextTokenCiphertext !== cursor.nextTokenCiphertext) throw fenceLost();
    if (work && parsed && response) {
      const currentWork = await tx.amazonOrderDetailWork.findFirstOrThrow({ where: { ...scope, id: work.id, sourceId: source.id, policyDigest, status: "PENDING" } });
      const current = await tx.amazonOrderRecord.findFirstOrThrow({ where: { ...scope, id: currentWork.orderRecordId, sourceId: source.id, marketplaceId: source.marketplaceId, amazonOrderId: work.amazonOrderId } });
      if (current.amazonSellerId && current.amazonSellerId !== source.authorization.amazonSellerId) throw new SyncInputError("订单已绑定其他卖家，禁止详情接管。", 409);
      const detailHash = digest(response.body);
      if (current.sourceUpdatedAt > parsed.sourceUpdatedAt || current.createdTime.getTime() !== parsed.createdTime.getTime()) throw new SyncInputError("订单详情版本落后或创建时间冲突，未覆盖现有事实。");
      if (current.detailsUpdatedAt?.getTime() === parsed.sourceUpdatedAt.getTime() && current.detailPolicyDigest === policyDigest && current.detailHash !== detailHash) throw new SyncInputError("同一订单详情版本出现冲突，未覆盖已提交详情。");
      await tx.amazonOrderRecord.update({ where: { id: current.id }, data: { sourceRunId: run.id, amazonSellerId: source.authorization.amazonSellerId, sourceUpdatedAt: parsed.sourceUpdatedAt, rawStatus: parsed.rawStatus, normalizedStatus: parsed.normalizedStatus, capturedAt, detailsUpdatedAt: parsed.sourceUpdatedAt, detailPolicyDigest: policyDigest, detailHash,
        detailCiphertext: seal(rawResponseEnvelope(response.rawBody), scope, current.id, "amazon-order-detail.v1"), fulfilledBy: parsed.fulfilledBy, fulfillmentServiceLevel: parsed.fulfillmentServiceLevel, grandTotalOriginal: parsed.grandTotal?.original ?? null, grandTotalAmount: parsed.grandTotal ? new Prisma.Decimal(parsed.grandTotal.original) : null, currencyCode: parsed.grandTotal?.currency ?? null } });
      await tx.amazonOrderItemRecord.deleteMany({ where: { ...scope, sourceId: source.id, orderRecordId: current.id } });
      if (parsed.items.length) await tx.amazonOrderItemRecord.createMany({ data: parsed.items.map(item => ({ ...scope, sourceId: source.id, orderRecordId: current.id, orderItemId: item.orderItemId, asin: item.asin, sellerSku: item.sellerSku, quantityOrdered: item.quantityOrdered, proceedsOriginal: item.proceeds?.original ?? null, proceedsAmount: item.proceeds ? new Prisma.Decimal(item.proceeds.original) : null, currencyCode: item.proceeds?.currency ?? null })) });
      await tx.amazonOrderDetailWork.update({ where: { id: work.id }, data: { status: "SUCCEEDED", completedAt: capturedAt } });
      await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: maxPages + run.detailsCompletedCount + 1, phase: "ROWS_COMMITTED", rowsCommitted: parsed.items.length, totalRows: parsed.items.length, checkedAt: capturedAt, replayed });
    }
    const pendingDetails = await tx.amazonOrderDetailWork.count({ where: { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest, status: "PENDING" } });
    const listComplete = historyReplay ? run.paginationComplete : currentCursor.listComplete;
    const complete = listComplete && pendingDetails === 0;
    const priorCoverage = ((run.summary as Prisma.JsonObject | null)?.coverage ?? {}) as Prisma.JsonObject;
    const coverage = { type: "incremental_window", apiVersion: "2026-01-01", window, complete, ...(historyReplay ? { orderHistoryReplay: true, cursorDigest: priorCoverage.cursorDigest } : {}), historicalBackfill: priorCoverage.historicalBackfill ?? null, listComplete, detailsEnabled: true, detailsComplete: complete, pendingDetails, piiCollected: null, factsContainPii: false, rawMayContainPii: true, rowCount: await tx.amazonOrderRecord.count({ where: { ...scope, sourceId: source.id } }) };
    if (!historyReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } });
    if (complete && !historyReplay) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: coverage.rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : pendingDetails ? "FETCHING_DETAILS" : "FETCHING", ...(work ? { detailsCompletedCount: { increment: 1 } } : {}), paginationComplete: listComplete, summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    if (complete) await persistWindowCheckpoints(tx, run, capturedAt);
    await log(tx, run, complete ? "ORDER_WINDOW_COMPLETED" : "ORDER_DETAIL_COMMITTED");
  });
};
}
