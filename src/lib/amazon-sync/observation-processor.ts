import { promotionsRequest, promotionsContract, reusablePromotionSummary, assertPromotionSummaryMatchesDetail } from "./promotions";
import { registerArchivedFields } from "./field-registry";
import { rawResponseEnvelope } from "./raw-fields";
import { brandFairTurn } from "./brand-fairness";
import { continuityProbeDue } from "./continuity-access";
import { resolvedProductPolicy, type ProductManifest } from "./product-discovery";
import { deduplicateFacts } from "./observation-parsers";
import { completeNotificationType, completeProductObject, skipFeedbackAsin, advanceObservation, parseObservationState, observationOperation, type ObservationState } from "./observation-machine";
import { observationReportSpec, type AnalyticsPolicy } from "./observation-policy";
import { parseObservationPolicy } from "./observation-policy";
import { automaticPlanKey } from "./automatic-schedule";
import { reserveOrderToken } from "./orders-rate-limit";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { syncCenterEnabled, SyncInputError } from "./policy";
import { canonical, digest, seal, unseal } from "./approval-policy";
import type { SyncProcessorRuntime } from './processor-runtime';

export function createObservationProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "leaseMs" | "scopeLock" | "assertActor" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistOrderRequests" | "fenceLost">) {
  const { prisma, leaseMs, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistOrderRequests, fenceLost } = runtime;
return async function executeObservationSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[]) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); return assertLiveSource(tx, run); });
  const configuredPolicy = parseObservationPolicy(["promotions", "brand_analytics", "buy_box_history", "customer_feedback"].includes(run.resource) ? (run.frozenScope as { domainPolicy?: unknown }).domainPolicy : source.domainPolicy, run.resource);
  const manifest = (run.frozenScope as { productManifest?: ProductManifest }).productManifest;
  const policy = resolvedProductPolicy(configuredPolicy, manifest);
  let state = parseObservationState(run.checkpointCiphertext ? unseal(run.checkpointCiphertext, scope, run.id, "amazon-observation-state.v1").state : null, policy);
  if (observationOperation(state, policy.resource) === "uncertainCreate") throw new SyncInputError("报告申请结果不确定；禁止自动再次创建，需核对原任务。", 409);
  const saveState = async (tx: Prisma.TransactionClient, next: ObservationState) => {
    const checkpointCiphertext = seal({ state: next }, scope, run.id, "amazon-observation-state.v1");
    Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { checkpointCiphertext, leaseExpiresAt: new Date(Date.now() + leaseMs) } }));
  };
  if (policy.resource === "promotions" && state.promotions?.stage === "DETAIL" && source.activeRunId && source.activeRunId !== run.id) {
    const promotion = state.promotions, promotionId = promotion.ids[promotion.index];
    const reused = await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run);
      if (await stopForControl(tx, run) || live.activeRunId !== source.activeRunId) return false;
      const previousRun = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: live.activeRunId!, sourceId: live.id, resource: "promotions", executionVersion: 2, status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true } });
      if (!previousRun || (previousRun.frozenScope as { sourceRevision?: number; authorizationRevision?: number }).sourceRevision !== live.revision || previousRun.authorizationRevision !== run.authorizationRevision) return false;
      const filter = { ...scope, sourceId: live.id, kind: "PROMOTION_SUMMARY", facts: { path: ["promotionId"], equals: promotionId } };
      const [before, current] = await Promise.all([
        tx.amazonDomainObservation.findFirst({ where: { ...filter, sourceRunId: previousRun.id } }),
        tx.amazonDomainObservation.findFirst({ where: { ...filter, sourceRunId: run.id } }),
      ]);
      const prior = await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceId: live.id, sourceRunId: previousRun.id, kind: { in: ["PROMOTION", "PROMOTION_SELECTION", "PROMOTION_ITEM"] }, facts: { path: ["promotionId"], equals: promotionId } }, take: policy.maxRows + 1 });
      const detail = prior.find(row => row.kind === "PROMOTION");
      if (!before || !current || !detail || !reusablePromotionSummary(before.facts, current.facts, detail.capturedAt, new Date())) return false;
      if (run.processedCount + prior.length > policy.maxRows) throw new SyncInputError("促销增量复用超出行数预算。", 409);
      const count = await tx.amazonDomainObservation.createMany({ data: prior.map(row => ({ ...scope, sourceId: live.id, sourceRunId: run.id, id: digest([run.id, row.kind, row.businessKey]), kind: row.kind, businessKey: row.businessKey, asin: row.asin, sellerSku: row.sellerSku, searchTerm: row.searchTerm, facts: row.facts as Prisma.InputJsonValue, capturedAt: row.capturedAt })), skipDuplicates: true });
      promotion.index++; promotion.stage = promotion.index === promotion.ids.length ? "COMPLETE" : "DETAIL";
      if (promotion.stage === "COMPLETE") state.stage = "COMPLETE";
      await saveState(tx, state);
      Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { processedCount: { increment: prior.length }, insertedCount: { increment: count.count }, skippedCount: { increment: prior.length - count.count } } }));
      await log(tx, run, "PROMOTION_UNCHANGED_TERMINAL_REUSED");
      return true;
    });
    if (reused) { await yieldSlice(run, new Date()); return; }
  }
  if (state.stage === "COMPLETE") {
    await assertActor(run);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope); await assertFence(tx, run); const live = await assertLiveSource(tx, run);
      if (await stopForControl(tx, run)) return;
      const rowCount = await tx.amazonDomainObservation.count({ where: { ...scope, sourceRunId: run.id, sourceId: live.id } });
      const allFeedbackUnavailable = policy.resource === "customer_feedback" && policy.asins.length > 0 && (state.unavailableObjectIndexes?.length ?? 0) >= policy.asins.length && rowCount === 0;
      if (rowCount !== run.insertedCount || rowCount + run.skippedCount !== run.processedCount || (!state.requests && !(manifest?.total === 0 && state.planIndex === 0 && rowCount === 0) && !allFeedbackUnavailable) || !syncCenterEnabled(run)) throw new SyncInputError("观察记录完整性校验失败。");
      if (state.unavailableObjectIndexes?.length || state.unavailableNotificationTypes?.length) {
        const coverage = { complete: false, accountUniverseComplete: false, rowCount, requestedObjects: state.planIndex, unavailableObjects: state.unavailableObjectIndexes?.length ?? 0, unavailableNotificationTypes: state.unavailableNotificationTypes ?? [], unavailableObjectIndexes: state.unavailableObjectIndexes, reason: "UPSTREAM_OBJECT_NOT_FOUND", capturedAt: new Date().toISOString() };
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "PARTIAL_SUCCESS", stage: "OBJECTS_UNAVAILABLE", paginationComplete: true, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, summary: { coverage }, error: "部分对象在 Amazon 返回 404；其他对象已采集，原发布版本保留，缺口未标为完成。" } });
        await log(tx, run, "OBSERVATIONS_PARTIAL_OBJECTS_UNAVAILABLE");
        return;
      }
      if ((policy.resource === "listing_details" || policy.resource === "catalog_items") && policy.discovery && (state.planIndex !== (policy.resource === "listing_details" ? policy.sellerSkus.length : policy.asins.length) || rowCount !== state.planIndex)) throw new SyncInputError("全店详情分片尚未完整提交，不能发布。");
      const coverage = { ...(manifest ? { discovery: manifest, catalogSnapshotComplete: true, noData: manifest.total === 0 } : {}), type: "APPROVED_SCOPE_OBSERVATION", resource: policy.resource, complete: true, accountUniverseComplete: false, rowCount, capturedFrom: run.executionStartedAt!.toISOString(), capturedTo: new Date().toISOString(), ...(policy.resource === "promotions" ? { apiVersion: promotionsContract.version, discoveredPromotions: state.promotions?.ids.length ?? 0, retainedPromotions: state.promotions?.retainedPromotions ?? 0, totalResults: state.promotions?.totalResults ?? null, historicalComplete: false, historyBasis: promotionsContract.history, feeSemantics: promotionsContract.feeSemantics } : policy.resource === "notifications" ? { scope: "SELLER_SUBSCRIPTION", notificationTypes: policy.notificationTypes, eventDeliveryVerified: false } : policy.resource === "fulfillment" ? { planIds: policy.discoverPlans ? state.discoveredPlanIds ?? [] : policy.planIds, discoveryComplete: !!policy.discoverPlans, marketplaceVerified: true, quantitySemantics: "DECLARED_ONLY", transportEventsAvailable: false } : policy.resource === "listing_details" ? { sellerSkus: policy.sellerSkus, attributeCoverage: "PRODUCT_FIELD_ALLOWLIST" } : policy.resource === "catalog_items" ? { asins: policy.asins, attributeCoverage: "PRODUCT_FIELD_ALLOWLIST" } : policy.resource === "pricing" ? { asins: policy.asins, ownPriceCoverage: "APPROVED_ASINS_NEW_B2C_GET_PRICING" } : policy.resource === "customer_feedback" ? { asins: policy.asins, apiVersion: "2024-06-01", topicsSortBy: ["MENTIONS", "STAR_RATING_IMPACT"], refresh: "WEEKLY", availability: "EN_ONLY_US_UK_FR_IT_DE_ES_JP", replacesProductReviewDetail: false, historicalComplete: false } : { from: policy.from, to: policy.to, asins: policy.asins, ...(policy.resource === "brand_analytics" ? { reportKind: policy.reportKind, reportPeriod: policy.reportPeriod, eligibility: "UPSTREAM_REPORT_PUBLISHED", historicalComplete: false } : {}), reportId: state.reportId! }) };
      await tx.amazonSyncDataSource.update({ where: { id: live.id }, data: { activeRunId: run.id, lastSuccessAt: new Date(), rowCount, coverage } });
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { coverage } } });
      // A failed report may have deferred its plan for a day. Once that same
      // checkpoint succeeds, wake only an already-enabled finite brand plan.
      // The scheduler still checks the manifest and never recreates uncertain work.
      if (policy.resource === "brand_analytics" && (parseObservationPolicy(live.domainPolicy, "brand_analytics") as AnalyticsPolicy).collection) {
        const now = new Date();
        await tx.amazonSyncSchedule.updateMany({ where: { ...scope, resource: "brand_analytics", executionVersion: 2, enabled: true, planKey: automaticPlanKey(live.id), nextRunAt: { gt: now }, targets: { some: { sourceId: live.id } } }, data: { nextRunAt: now } });
      }
      await log(tx, run, "OBSERVATIONS_PUBLISHED");
    }); return;
  }
  // Reparse the authenticated original archive after a compatible parser fix.
  // No network call, new report, or request budget reset is involved.
  let archivedDownload: string | undefined;
  if (["brand_analytics", "buy_box_history"].includes(policy.resource) && state.stage === "DOWNLOAD") {
    const page = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: run.resource, requestMetadata: { path: ["operation"], equals: "downloadReportDocument" } }, orderBy: { page: "desc" } });
    if (page) {
      const raw = unseal(page.rawCiphertext, scope, run.id + ":" + page.page, "amazon-observation-raw.v1").rawBody;
      if (typeof raw !== "string" || digest(raw) !== page.bodySha256) throw new SyncInputError("报告归档完整性校验失败。", 409);
      try { advanceObservation(policy, state, null, { rawBody: raw, marketplaceId: source.marketplaceId, sellerId: source.authorization.amazonSellerId }); archivedDownload = raw; }
      catch { /* Keep the normal download path for an unchanged invalid report. */ }
    }
  }
  if (["promotions", "pricing", "listing_details", "catalog_items", "notifications", "fulfillment", "customer_feedback"].includes(policy.resource) && state.requests > 0) {
    const page = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page: state.requests, resource: policy.resource } });
    const metadata = page?.requestMetadata as { operation?: string; objectIndex?: number; tokenHash?: string; requestPathHash?: string } | undefined;
    if (page && metadata?.operation === observationOperation(state, policy.resource)) {
      const raw = unseal(page.rawCiphertext, scope, `${run.id}:${page.page}`, "amazon-observation-raw.v1").rawBody;
      if (typeof raw !== "string" || digest(raw) !== page.bodySha256) throw new SyncInputError("观察原件完整性校验失败。", 409);
      let matches = policy.resource === "promotions" ? page.page > run.pagesCompleted && metadata.requestPathHash === digest(promotionsRequest(state.promotions!, source.marketplaceId).path) : policy.resource === "notifications" ? page.page > run.pagesCompleted && metadata.objectIndex === state.planIndex && metadata.tokenHash === digest(state.token ?? null)
        : policy.resource === "customer_feedback" ? page.page > run.pagesCompleted && metadata.objectIndex === state.planIndex && metadata.operation === observationOperation(state, policy.resource)
        : policy.resource === "pricing" || policy.resource === "fulfillment" && page.page > run.pagesCompleted;
      if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
        // Explicit identifier lists used to omit objectIndex. Their own raw
        // identifier can bind the response to the frozen object; a committed
        // prior object must never be replayed as the next one.
        const body = JSON.parse(raw) as { sku?: unknown; asin?: unknown } | null;
        matches = metadata.objectIndex === undefined
          ? policy.resource === "listing_details" ? body?.sku === policy.sellerSkus[state.planIndex] : body?.asin === policy.asins[state.planIndex]
          : metadata.objectIndex === state.planIndex;
      }
      if (matches) {
        // Reuse a response archived before a parser failure; no extra Amazon call.
        advanceObservation(policy, state, JSON.parse(raw), { rawBody: raw, marketplaceId: source.marketplaceId, sellerId: source.authorization.amazonSellerId });
        archivedDownload = raw;
      }
    }
  }
  if (archivedDownload === undefined && state.requests >= policy.maxRequests) throw new SyncInputError("观察任务已达到审批请求预算，未发布新版本。", 409);
  const operation = observationOperation(state, policy.resource), auth = source.authorization;
  const key = { ...scope, authorizationId: auth.id, operation };
  // Same bucket namespace as existing Reports receivers. Never split by site.
  const bucketKey = digest([`${operation}.${["createReport", "getReport", "getReportDocument"].includes(operation) ? "2021-06-30" : policy.resource === "promotions" ? "2025-12-01" : policy.resource === "notifications" ? "v1" : policy.resource === "listing_details" ? "2021-08-01" : policy.resource === "catalog_items" ? "2022-04-01" : policy.resource === "customer_feedback" ? "2024-06-01" : policy.resource === "fulfillment" ? "2024-03-20" : operation === "getPricing" ? "v0" : "2022-05-01"}`, auth.amazonSellerId, policy.applicationId]);
  const reserve = archivedDownload !== undefined ? { allowed: true, nextAt: new Date() } : await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bucketKey}, 0))`;
    const budget = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: key } });
    if (budget && budget.nextRequestAt > new Date()) return { allowed: false, nextAt: budget.nextRequestAt };
    if (policy.resource === "brand_analytics") {
      const turn = await brandFairTurn(tx, run, policy, operation, async peer => { await assertLiveSource(tx, peer); });
      if (!turn.allowed) return turn;
    }
    const bucket = await tx.amazonSyncTokenBucket.findUnique({ where: { bucketKey } });
    if (await continuityProbeDue(tx, source)) return { allowed: false, nextAt: new Date(Date.now() + 5000) };
    const result = reserveOrderToken(bucket, { requestsPerSecond: policy.requestsPerSecond, burst: 1 }, new Date());
    await tx.amazonSyncTokenBucket.upsert({ where: { bucketKey }, create: { bucketKey, tokens: result.tokens, replenishedAt: result.replenishedAt }, update: { tokens: result.tokens, replenishedAt: result.replenishedAt } });
    if (result.allowed) {
      state.requests++; if (state.stage === "CREATE") state.stage = "CREATING";
      await saveState(tx, state);
      const nextRequestAt = new Date(Date.now() + Math.ceil(1000 / policy.requestsPerSecond));
      await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt }, update: { nextRequestAt } });
    }
    return result;
  });
  if (!reserve) return;
  if (!reserve.allowed) { await yieldSlice(run, reserve.nextAt); return; }
  let body: unknown, rawBody = ""; events.length = 0;
  try {
    if (archivedDownload !== undefined) { rawBody = archivedDownload; body = state.stage === "DOWNLOAD" ? null : JSON.parse(rawBody); }
    else if (policy.resource === "promotions") {
      const result = await client.getPromotionsPage(promotionsRequest(state.promotions!, source.marketplaceId)); body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "notifications") {
      const result = await client.getNotificationSubscriptions({ notificationType: policy.notificationTypes[state.planIndex], nextToken: state.token });
      body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "fulfillment") {
      const inboundPlanId = (policy.discoverPlans ? state.discoveredPlanIds ?? [] : policy.planIds)[state.planIndex], shipmentId = state.shipmentIds[state.shipmentIndex];
      const result = state.stage === "DISCOVER_PLANS" ? await client.listInboundPlans({ paginationToken: state.token }) : state.stage === "PLAN" || state.stage === "VERIFY_PLAN" ? await client.getInboundPlan({ inboundPlanId }) : state.stage === "PLAN_ITEMS" ? await client.listInboundPlanItems({ inboundPlanId, paginationToken: state.token }) : state.stage === "SHIPMENT" ? await client.getInboundShipment({ inboundPlanId, shipmentId }) : await client.listInboundShipmentItems({ inboundPlanId, shipmentId, paginationToken: state.token });
      body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "listing_details" || policy.resource === "catalog_items") {
      const result = policy.resource === "listing_details" ? await client.getListingDetail({ sellerId: auth.amazonSellerId, sellerSku: policy.sellerSkus[state.planIndex], marketplaceId: source.marketplaceId }) : await client.getCatalogDetail({ asin: policy.asins[state.planIndex], marketplaceId: source.marketplaceId });
      body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "pricing") {
      const asins = policy.asins.slice(state.planIndex, state.planIndex + 20);
      const result = state.stage === "OWN_PRICE" ? await client.getOwnPrices({ asins, marketplaceId: source.marketplaceId }) : await client.getCompetitiveSummary({ asins, marketplaceId: source.marketplaceId }); body = result.body; rawBody = result.rawBody;
    } else if (policy.resource === "customer_feedback") {
      const asin = policy.asins[state.planIndex];
      const result = state.stage === "FEEDBACK_TRENDS" ? await client.getCustomerFeedbackTrends({ asin, marketplaceId: source.marketplaceId }) : await client.getCustomerFeedbackTopics({ asin, marketplaceId: source.marketplaceId, sortBy: state.stage === "FEEDBACK_TOPICS_IMPACT" ? "STAR_RATING_IMPACT" : "MENTIONS" });
      body = result.body; rawBody = result.rawBody;
    } else if (state.stage === "CREATING") body = await client.createObservationReport(observationReportSpec(policy, source.marketplaceId));
    else if (state.stage === "POLL") body = await client.getReport(state.reportId!);
    else if (state.stage === "DOCUMENT") body = await client.getReportDocument(state.documentId!);
    else if (state.stage === "DOWNLOAD") { rawBody = archivedDownload ?? await client.downloadReportText(state.document, policy.resource === "brand_analytics" ? { timeoutMs: 90_000 } : {}); body = null; }
    else throw new SyncInputError("观察任务阶段无效。");
    if (!rawBody) rawBody = JSON.stringify(body);
  } catch (error) {
    await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, new Date(), error);
    if (policy.resource === "notifications" && error instanceof AmazonSpApiError && [403, 404].includes(error.status ?? 0)) {
      state.unavailableNotificationTypes = [...(state.unavailableNotificationTypes ?? []), policy.notificationTypes[state.planIndex]];
      state.notificationFailures = [...(state.notificationFailures ?? []), { index: state.planIndex, ...(state.token ? { token: state.token } : {}), priorTokens: [...state.priorTokens] }];
      completeNotificationType(state, policy);
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return;
        await saveState(tx, state);
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { failedCount: { increment: 1 } } });
        await log(tx, run, "NOTIFICATION_TYPE_UNAVAILABLE");
      });
      await yieldSlice(run, new Date()); return;
    }
    // An object-level 404 is neither an empty object nor a failed whole domain.
    // Keep the exact missing ordinal in the encrypted checkpoint and continue;
    // the terminal partial result never replaces the last complete publication.
    if (["catalog_items", "listing_details"].includes(policy.resource) && state.stage === "PRODUCT_DETAIL" && error instanceof AmazonSpApiError && error.status === 404) {
      state.unavailableObjectIndexes = [...(state.unavailableObjectIndexes ?? []), state.planIndex];
      completeProductObject(state, policy);
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) throw fenceLost();
        await saveState(tx, state);
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { failedCount: { increment: 1 } } });
        await log(tx, run, "OBSERVATION_OBJECT_NOT_FOUND");
      });
      await yieldSlice(run, new Date()); return;
    }
    if (policy.resource === "customer_feedback" && ["FEEDBACK_TOPICS_MENTIONS", "FEEDBACK_TOPICS_IMPACT", "FEEDBACK_TRENDS"].includes(state.stage) && error instanceof AmazonSpApiError && error.status === 404) {
      state.unavailableObjectIndexes = [...(state.unavailableObjectIndexes ?? []), state.planIndex];
      skipFeedbackAsin(state, policy);
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) throw fenceLost();
        await saveState(tx, state);
        await tx.amazonSyncRun.update({ where: { id: run.id }, data: { failedCount: { increment: 1 } } });
        await log(tx, run, "OBSERVATION_OBJECT_NOT_FOUND");
      });
      await yieldSlice(run, new Date()); return;
    }
    // A definite 429 means create was rejected. All uncertain outcomes retain intent.
    if (state.stage === "CREATING" && error instanceof AmazonSpApiError && error.status === 429 || state.stage === "DOWNLOAD" && error instanceof AmazonSpApiError && [403, 404].includes(error.status ?? 0)) {
      state.stage = state.stage === "CREATING" ? "CREATE" : "DOCUMENT"; delete state.document;
      await prisma.$transaction(async tx => { await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run); await saveState(tx, state); });
      await yieldSlice(run, new Date(Date.now() + Math.max(60_000, error instanceof AmazonSpApiError ? error.retryAfterMs : 0))); return;
    }
    throw error;
  }
  if (archivedDownload === undefined) await persistOrderRequests(run, events, bucketKey, policy.requestsPerSecond, new Date());
  const capturedAt = new Date();
  // Archive before validation, including rejected contracts; never expose raw data.
  if (Buffer.byteLength(rawBody, "utf8") > 4 * 1024 * 1024) throw new SyncInputError("Amazon 单次观察响应超过 4 MiB 限制；保留旧版本。", 413);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) throw fenceLost();
    if (archivedDownload === undefined) await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page: state.requests, resource: run.resource, requestMetadata: { operation, ...(policy.resource === "promotions" ? { apiVersion: "2025-12-01", requestPathHash: digest(promotionsRequest(state.promotions!, source.marketplaceId).path) } : {}), ...(["listing_details", "catalog_items", "customer_feedback"].includes(policy.resource) ? { objectIndex: state.planIndex } : {}), ...(policy.resource === "notifications" ? { objectIndex: state.planIndex, tokenHash: digest(state.token ?? null) } : {}), ...(manifest ? { batchIndex: Math.floor(state.planIndex / 100), objectIndex: state.planIndex } : {}) }, rawCiphertext: seal(rawResponseEnvelope(rawBody, state.stage === "DOWNLOAD" && (policy.resource === "brand_analytics" || policy.resource === "buy_box_history") ? observationReportSpec(policy, source.marketplaceId).reportType : operation), scope, `${run.id}:${state.requests}`, "amazon-observation-raw.v1"), bodySha256: digest(rawBody), capturedAt } });
    await registerArchivedFields(tx, run, state.requests, rawBody, "JSON");
  });
  const result = advanceObservation(policy, state, body, { rawBody, marketplaceId: source.marketplaceId, sellerId: auth.amazonSellerId });
  if (policy.resource === "promotions") for (const row of result.rows) row.facts.provenance = { taskId: run.id, rawPage: state.requests, operation, apiVersion: "2025-12-01" };
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) throw fenceLost();
    if (run.processedCount + result.rows.length > policy.maxRows) throw new SyncInputError("观察记录超过审批行数预算。");
    let inserted = 0;
    if (policy.resource === "promotions" && state.promotions?.stage === "DETAIL") {
      const published = result.rows.find(row => row.kind === "PROMOTION" && row.facts.revision === "PUBLISHED");
      const summary = await tx.amazonDomainObservation.findFirst({ where: { ...scope, sourceId: source.id, sourceRunId: run.id, kind: "PROMOTION_SUMMARY", facts: { path: ["promotionId"], equals: state.promotions.ids[state.promotions.index] } }, select: { facts: true } });
      assertPromotionSummaryMatchesDetail(summary?.facts, published?.facts.promotion);
      for (const row of result.rows.filter(row => row.kind === "PROMOTION")) {
        const incoming = row.facts.promotion as { lastUpdatedDate: string };
        const previous = source.activeRunId ? await tx.amazonDomainObservation.findFirst({ where: { ...scope, sourceId: source.id, sourceRunId: source.activeRunId, kind: row.kind, businessKey: row.businessKey }, select: { facts: true } }) : null;
        const prior = (previous?.facts as { promotion?: { lastUpdatedDate?: string } } | null)?.promotion;
        if (prior?.lastUpdatedDate && Date.parse(incoming.lastUpdatedDate) < Date.parse(prior.lastUpdatedDate)) throw new SyncInputError("Amazon 促销详情早于已发布版本，拒绝旧版本覆盖。", 409);
      }
    }
    if (policy.resource === "promotions" && state.promotions?.stage === "SEARCH" && result.state.promotions?.stage !== "SEARCH" && source.activeRunId && source.activeRunId !== run.id) {
      const priorRun = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: source.activeRunId, sourceId: source.id, resource: "promotions", status: "SUCCEEDED", stage: "COMPLETED", paginationComplete: true } });
      const frozen = priorRun?.frozenScope as { sourceRevision?: number; authorizationId?: string; amazonSellerId?: string } | undefined;
      if (priorRun && frozen?.sourceRevision === source.revision && frozen.authorizationId === source.authorizationId && frozen.amazonSellerId === auth.amazonSellerId) {
        const summaries = await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceId: source.id, sourceRunId: priorRun.id, kind: "PROMOTION_SUMMARY" }, select: { facts: true }, take: policy.maxRows + 1 });
        const discovered = new Set(result.state.promotions!.ids);
        const absent = summaries.map(row => (row.facts as { promotionId?: string }).promotionId).filter((id): id is string => typeof id === "string" && !discovered.has(id));
        if (absent.length) {
          const priorRows = await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceId: source.id, sourceRunId: priorRun.id }, take: policy.maxRows + 1 });
          if (priorRows.length > policy.maxRows) throw new SyncInputError("促销历史保留超过行数预算；保留旧发布版本。", 409);
          const absentIds = new Set(absent);
          const previous = priorRows.filter(row => absentIds.has(String((row.facts as { promotionId?: string }).promotionId)));
          if (run.processedCount + result.rows.length + previous.length > policy.maxRows) throw new SyncInputError("促销历史保留超过行数预算；保留旧发布版本。", 409);
          for (const row of previous) result.rows.push({ kind: row.kind, businessKey: row.businessKey, asin: row.asin, sellerSku: row.sellerSku, searchTerm: row.searchTerm, facts: { ...(row.facts as Record<string, unknown>), observation: { currentDiscovery: false, lastCapturedAt: ((row.facts as { observation?: { lastCapturedAt?: string } }).observation?.lastCapturedAt ?? row.capturedAt.toISOString()), reason: "NOT_RETURNED_NOT_DELETION" } } });
          result.state.promotions!.retainedPromotions = absent.length;
        }
      }
    }
    if (run.processedCount + result.rows.length > policy.maxRows) throw new SyncInputError("观察记录超过行数预算。");
    const normalized = deduplicateFacts(result.rows, policy.maxRows);
    for (let offset = 0; offset < normalized.length; offset += 500) {
      const batch = normalized.slice(offset, offset + 500).map(row => ({ ...scope, sourceId: source.id, sourceRunId: run.id, id: digest([run.id, row.kind, row.businessKey]), ...row, facts: row.facts as Prisma.InputJsonValue, capturedAt }));
      const existing = new Map((await tx.amazonDomainObservation.findMany({ where: { ...scope, sourceRunId: run.id, id: { in: batch.map(row => row.id) } }, select: { id: true, facts: true } })).map(row => [row.id, row.facts]));
      for (const row of batch) if (existing.has(row.id) && canonical(existing.get(row.id)) !== canonical(row.facts)) throw new SyncInputError("重复观察业务键存在冲突，拒绝发布。");
      inserted += (await tx.amazonDomainObservation.createMany({ data: batch, skipDuplicates: true })).count;
    }
    await saveState(tx, result.state);
    Object.assign(run, await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: result.rows.length }, insertedCount: { increment: inserted }, skippedCount: { increment: result.rows.length - inserted } } }));
    await log(tx, run, "OBSERVATION_SLICE_COMMITTED");
  });
  state = result.state;
  await yieldSlice(run, new Date(Date.now() + (state.stage === "POLL" ? 60_000 : 0)));
};
}
