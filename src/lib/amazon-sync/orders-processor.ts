import { persistWindowCheckpoints } from "./window-checkpoints";
import { recordReportParseEvidence } from "./report-parse-evidence";
import { archiveResponse, replayResponse } from "./response-evidence";
import { continuityEvidence, continuityOrderTurn } from "./continuity-access";
import { assertOrderRoles, orderCursorDigest, orderWindowFromFrozen, parseOrderPage, parseOrderSyncPolicy } from "./orders";
import { orderBucketKey, reserveOrderToken } from "./orders-rate-limit";
import { randomUUID } from "node:crypto";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { officialEndpoint, SyncInputError } from "./policy";
import { digest } from "./approval-policy";
import type { SyncProcessorRuntime } from './processor-runtime';
import { createOrderDetailProcessor } from './order-detail-processor';
import { queueOrderBackfill } from './order-gaps';

export function createOrderProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "maxPages" | "maxRows" | "scopeLock" | "assertActor" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistOrderRequests" | "fenceLost" | "preflightRejected">) {
  const { prisma, maxPages, maxRows, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost, preflightRejected } = runtime;
  const executeOrderDetailSlice = createOrderDetailProcessor(runtime);
return async function executeOrderSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], now: () => Date = () => new Date()) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  await assertActor(run);
  const source = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run);
    return assertLiveSource(tx, run);
  });
  const policy = parseOrderSyncPolicy(source.orderPolicy), auth = source.authorization;
  officialEndpoint(auth.awsRegion, auth.endpoint);
  assertOrderRoles(auth, policy, run.trigger === "schedule", { ...scope, authorizationId: auth.id, authorizationRevision: auth.revision, marketplaceId: source.marketplaceId, currentEvidence: await continuityEvidence(prisma, source) });
  const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
  if (!sites.some(site => site.marketplaceId === source.marketplaceId)) throw preflightRejected("订单站点未验证。");
  const window = orderWindowFromFrozen((run.frozenScope as { orderWindow?: unknown } | null)?.orderWindow);
  const historyReplay = (run.frozenScope as { orderHistoryReplay?: unknown } | null)?.orderHistoryReplay === true;
  if (historyReplay && run.trigger !== "schedule") throw new SyncInputError("订单历史补采只能由自动计划执行。", 403);
  const frozenPolicy = (run.frozenScope as { orderPolicy?: unknown } | null)?.orderPolicy;
  if ((frozenPolicy !== undefined && digest(parseOrderSyncPolicy(frozenPolicy)) !== digest(policy)) || (policy.details && frozenPolicy === undefined)) throw preflightRejected("订单详情策略不在已批准执行范围内。");
  const detailPolicyDigest = policy.details ? digest(policy.details) : null;
  const bucketKey = orderBucketKey(auth.amazonSellerId, policy.applicationId);
  const prepared = await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return null;
    let cursor = await tx.amazonSyncResourceCursor.findUnique({ where: { sourceId: source.id } });
    if (cursor && (cursor.organizationId !== scope.organizationId || cursor.workspaceId !== scope.workspaceId || cursor.amazonSellerId !== auth.amazonSellerId || cursor.marketplaceId !== source.marketplaceId || cursor.resource !== "orders")) throw preflightRejected("订单游标与卖家绑定不匹配。");
    if (historyReplay) {
      if (!cursor || cursor.status !== "SUCCEEDED" || Date.parse(window.to) > cursor.watermarkTo.getTime() || cursor.detailPolicyDigest !== detailPolicyDigest) throw preflightRejected("订单历史补采不匹配已完成的前向游标或当前详情策略。");
      const coverage = ((run.summary as Prisma.JsonObject | null)?.coverage ?? {}) as Prisma.JsonObject;
      const currentDigest = orderCursorDigest(cursor);
      if (coverage.cursorDigest && coverage.cursorDigest !== currentDigest) throw preflightRejected("订单前向游标在历史补采期间发生变化，已停止以保护增量水位。");
    } else if (cursor && cursor.status !== "SUCCEEDED" && (cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to)) throw preflightRejected("订单窗口与未完成游标不匹配。");
    if (!historyReplay && cursor?.status === "SUCCEEDED" && cursor.activeRunId === run.id) return { complete: true as const, cursor };
    // Recovery approval is a point-in-time check. A worker with committed
    // progress must still own the cursor when it resumes, including raw replay.
    if (!historyReplay && (run.pagesCompleted > 0 || run.detailsCompletedCount > 0) && (!cursor || (cursor.status !== "SUCCEEDED" && cursor.activeRunId !== run.id))) throw preflightRejected("订单恢复游标缺失或已不属于当前任务，未重建或接管检查点。");
    if (historyReplay && run.pagesCompleted > 0 && !run.checkpointCiphertext) throw preflightRejected("订单历史补采分页检查点缺失，不能从头重试。");
    const starting = !historyReplay && (!cursor || cursor.status === "SUCCEEDED");
    if (!starting && cursor?.detailPolicyDigest !== detailPolicyDigest) throw preflightRejected("未完成窗口的详情策略发生变化。");
    if (!historyReplay && cursor && cursor.status === "SUCCEEDED" && Date.parse(window.to) <= cursor.watermarkTo.getTime()) throw preflightRejected("订单窗口已被其他任务完成，请重新申请。");
    if (!historyReplay) cursor = await tx.amazonSyncResourceCursor.upsert({
      where: { sourceId: source.id },
      create: { ...scope, id: randomUUID(), sourceId: source.id, resource: "orders", amazonSellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), activeRunId: run.id, status: "RUNNING", detailPolicyDigest },
      update: { activeRunId: run.id, status: "RUNNING", ...(starting ? { watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), nextTokenCiphertext: null, listComplete: false, detailPolicyDigest } : {}) },
    });
    if (!cursor) throw preflightRejected("订单游标缺失。");
    if (policy.details) {
      const work = await tx.amazonOrderDetailWork.findFirst({ where: { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest: detailPolicyDigest!, status: "PENDING" }, orderBy: [{ listedUpdatedAt: "asc" }, { id: "asc" }] });
      if (work || (historyReplay ? run.paginationComplete : cursor.listComplete)) return { complete: false as const, cursor, work, historyReplay };
    }
    const token = historyReplay ? decryptCheckpoint(run.checkpointCiphertext, scope, run.id) : decryptCheckpoint(cursor.nextTokenCiphertext, scope, cursor.id);
    const responseIdentity = { apiVersion: "2026-01-01", operation: "searchOrders", marketplaceId: source.marketplaceId, window, pageTokenHash: digest([window, token ?? null]) };
    const archivedResponse = await replayResponse(run, run.pagesCompleted + 1, responseIdentity, tx);
    if (archivedResponse !== null) return { complete: false as const, cursor, archivedResponse, reservation: { allowed: true, nextAt: now() } };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    if (!await continuityOrderTurn(tx, source, run.id)) { const budget = reserveOrderToken(bucket, policy, now()); return { complete: false as const, cursor, reservation: { allowed: false, nextAt: new Date(Math.max(now().getTime() + 5000, budget.nextAt.getTime())) } }; }
    const reservation = reserveOrderToken(bucket, policy, now());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: reservation.tokens, replenishedAt: reservation.replenishedAt }, update: { tokens: reservation.tokens, replenishedAt: reservation.replenishedAt } });
    return { complete: false as const, cursor, reservation, historyReplay };
  });
  if (!prepared) return;
  if (prepared.complete) return;
  if ("work" in prepared) { await executeOrderDetailSlice(run, source, policy, window, prepared.cursor, prepared.work ?? null, client, events, now, prepared.historyReplay); return; }
  if (!prepared.reservation.allowed) { await yieldSlice(run, prepared.reservation.nextAt); return; }
  const token = prepared.historyReplay ? decryptCheckpoint(run.checkpointCiphertext, scope, run.id) : decryptCheckpoint(prepared.cursor.nextTokenCiphertext, scope, prepared.cursor.id);
  const tokenHash = digest([window, token ?? null]);
  if (await prisma.amazonSyncPage.findUnique({ where: { taskId_tokenHash: { taskId: run.id, tokenHash } } })) throw new Error("订单分页 token 循环。");
  events.length = 0;
  const pageNumber = run.pagesCompleted + 1;
  const responseIdentity = { apiVersion: "2026-01-01", operation: "searchOrders", marketplaceId: source.marketplaceId, window, pageTokenHash: tokenHash };
  const archived = "archivedResponse" in prepared ? prepared.archivedResponse ?? null : null;
  let response: Awaited<ReturnType<AmazonSpApiClient["searchOrders"]>>;
  try {
    // Recheck authorization immediately before any HTTP, including the LWA refresh.
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); });
    response = archived === null ? await client.searchOrders({ marketplaceId: source.marketplaceId, lastUpdatedAfter: window.from, lastUpdatedBefore: window.to, paginationToken: token }) : { rawBody: archived, body: JSON.parse(archived) };
  } catch (error) {
    await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now(), error);
    throw error;
  }
  if (archived === null) {
    await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, now());
    await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await archiveResponse(tx, run, pageNumber, responseIdentity, response.rawBody); });
  }
  const page = parseOrderPage(response.body, source.marketplaceId, policy, window);
  if (page.orders.length > 100 || run.pagesCompleted >= maxPages || run.processedCount + page.orders.length > maxRows) throw new Error("订单窗口超过安全容量，请缩小窗口并重新审批。");
  if (page.nextToken && digest([window, page.nextToken]) === tokenHash) throw new Error("订单分页 token 循环。");
  const capturedAt = now();
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    const currentCursor = await tx.amazonSyncResourceCursor.findUniqueOrThrow({ where: { sourceId: source.id } });
    if (historyReplay
      ? currentCursor.status !== "SUCCEEDED" || orderCursorDigest(currentCursor) !== orderCursorDigest(prepared.cursor)
      : currentCursor.activeRunId !== run.id || currentCursor.nextTokenCiphertext !== prepared.cursor.nextTokenCiphertext) throw fenceLost();
    let inserted = 0, updated = 0, skipped = 0;
    const pendingWorkIds: string[] = [];
    for (const row of page.orders) {
      const key = { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, amazonOrderId: row.amazonOrderId };
      const existing = await tx.amazonOrderRecord.findUnique({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_amazonOrderId: key } });
      if (existing && existing.sourceUpdatedAt.getTime() === row.sourceUpdatedAt.getTime() && (existing.rawStatus !== row.rawStatus || existing.createdTime.getTime() !== row.createdTime.getTime())) throw new SyncInputError("同一订单版本出现冲突数据，已保留游标并阻止提交。");
      if (existing && existing.sourceId !== source.id) throw new SyncInputError("订单事实不属于当前数据源，禁止跨绑定覆盖。");
      const skip = existing && (existing.sourceUpdatedAt > row.sourceUpdatedAt || (existing.sourceUpdatedAt.getTime() === row.sourceUpdatedAt.getTime() && existing.rawStatus === row.rawStatus && existing.normalizedStatus === row.normalizedStatus));
      const data = { ...scope, sourceId: source.id, sourceRunId: run.id, sellerAccountId: source.sellerAccountId, amazonSellerId: auth.amazonSellerId, marketplaceTimeZone: policy.marketplaceTimeZone, ...row, capturedAt };
      if (skip) skipped++;
      else {
        await tx.amazonOrderRecord.upsert({ where: { organizationId_workspaceId_sellerAccountId_marketplaceId_amazonOrderId: key }, create: { id: digest(key), ...data }, update: data });
        if (existing) updated++; else inserted++;
      }
      if (policy.details && (!existing || existing.sourceUpdatedAt <= row.sourceUpdatedAt) && !(existing?.detailsUpdatedAt && existing.detailsUpdatedAt >= row.sourceUpdatedAt && existing.detailPolicyDigest === detailPolicyDigest)) {
        const workKey = { sourceId: source.id, amazonOrderId: row.amazonOrderId, listedUpdatedAt: row.sourceUpdatedAt, policyDigest: detailPolicyDigest! };
        await tx.amazonOrderDetailWork.upsert({ where: { sourceId_amazonOrderId_listedUpdatedAt_policyDigest: workKey }, create: { id: digest(workKey), ...scope, ...workKey, orderRecordId: existing?.id ?? digest(key), watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to) }, update: {} });
        pendingWorkIds.push(digest(workKey));
      }
    }
    if (pendingWorkIds.length) await tx.amazonOrderDetailWork.updateMany({ where: { ...scope, sourceId: source.id, policyDigest: detailPolicyDigest!, id: { in: pendingWorkIds }, status: { in: ["PENDING", "SUCCEEDED"] } }, data: { status: "PENDING", completedAt: null, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to) } });
    const workWhere = { ...scope, sourceId: source.id, watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), policyDigest: detailPolicyDigest ?? "" };
    if (policy.details && await tx.amazonOrderDetailWork.count({ where: workWhere }) > policy.details.maxOrders) throw new SyncInputError("订单详情超过本窗口批准的订单预算，未提交当前页。");
    // Current-window work owns the approved capacity. Only the final list page
    // can allocate the remainder to older missing/stale details.
    const historicalBackfill = !page.nextToken && policy.details?.backfillExisting
      ? await queueOrderBackfill(tx, run, source, policy, window) : null;
    await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: pageNumber, tokenHash, rowCount: page.orders.length } });
    const pending = policy.details ? await tx.amazonOrderDetailWork.count({ where: { ...workWhere, status: "PENDING" } }) : 0;
    const listComplete = !page.nextToken;
    const complete = listComplete && !pending;
    if (!historyReplay) await tx.amazonSyncResourceCursor.update({ where: { sourceId: source.id }, data: { listComplete, nextTokenCiphertext: encryptCheckpoint(page.nextToken, scope, prepared.cursor.id), status: complete ? "SUCCEEDED" : "RUNNING", ...(complete ? { lastSuccessAt: capturedAt } : {}) } });
    const cursorDigest = historyReplay ? orderCursorDigest(currentCursor) : undefined;
    const coverage = { type: "incremental_window", apiVersion: "2026-01-01", window, complete, ...(historyReplay ? { orderHistoryReplay: true, cursorDigest } : {}), historicalBackfill, listComplete, detailsEnabled: !!policy.details, detailsComplete: !!policy.details && complete, pendingDetails: pending, piiCollected: null, factsContainPii: false, rawMayContainPii: true, rowCount: await tx.amazonOrderRecord.count({ where: { ...scope, sourceId: source.id } }) };
    if (complete && !historyReplay) await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: capturedAt, rowCount: coverage.rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: complete ? "SUCCEEDED" : "WAITING", stage: complete ? "COMPLETED" : pending ? "FETCHING_DETAILS" : "FETCHING", pagesCompleted: { increment: 1 }, processedCount: { increment: page.orders.length }, insertedCount: { increment: inserted }, updatedCount: { increment: updated }, skippedCount: { increment: skipped }, paginationComplete: listComplete, checkpointCiphertext: encryptCheckpoint(page.nextToken, scope, run.id), summary: { coverage }, finishedAt: complete ? capturedAt : null, nextAttemptAt: capturedAt, leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
    if (complete) await persistWindowCheckpoints(tx, run, capturedAt);
    await recordReportParseEvidence(tx, run, { rawTaskId: run.id, rawPage: pageNumber, phase: "ROWS_COMMITTED", rowsCommitted: inserted + updated, processedRows: page.orders.length, totalRows: page.orders.length, checkedAt: capturedAt, replayed: archived !== null });
    await log(tx, run, complete ? "ORDER_WINDOW_COMPLETED" : "ORDER_PAGE_COMMITTED");
  });
};
}
