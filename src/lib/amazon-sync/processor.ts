import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getOrganizationRolePermissions } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { AmazonSpApiClient, AmazonSpApiError, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { decryptAmazonSpApiCredentials } from "@/lib/amazon/integration-secrets";
import { extractAmazonInventorySnapshots } from "@/lib/amazon/inventory";
import { extractCatalogPage } from "@/lib/amazon/catalog";
import { withAmazonSyncLock } from "@/lib/operations/sync-lock";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { implementedDomain, officialEndpoint, retryDelay, syncCenterEnabled, type SyncScope } from "./policy";
import { scopeLock } from "./service";

const leaseMs = 5 * 60_000, maxPages = 1000, maxRows = 50000, pagesPerSlice = 5;
export class SyncFenceLost extends Error {}
export function inventoryNextToken(value: unknown) {
  const record = value as { pagination?: { nextToken?: unknown } };
  if (!record.pagination) return undefined;
  if (typeof record.pagination !== "object" || (record.pagination.nextToken !== undefined && typeof record.pagination.nextToken !== "string")) throw new Error("分页结构无效。");
  return record.pagination.nextToken?.trim() || undefined;
}
export function sourceTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("数据源更新时间无效。");
  return new Date(value);
}
export function validateInventoryPage(value: unknown) {
  const root = value as { payload?: { inventorySummaries?: unknown }; inventorySummaries?: unknown };
  const rows = root?.payload?.inventorySummaries ?? root?.inventorySummaries;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || typeof row.sellerSku !== "string" || !row.sellerSku.trim())) throw new Error("库存页缺少关键字段；不能发布不完整快照。");
  if (rows.length > 1000) throw new Error("单页超过安全行数限制。");
  const timestamps = new Map<string, Date | null>();
  for (const raw of rows as Record<string, unknown>[]) {
    const key = JSON.stringify([String(raw.sellerSku).trim().slice(0, 500), typeof raw.condition === "string" ? raw.condition.trim().slice(0, 500) : ""]);
    const updated = sourceTimestamp(raw.lastUpdatedTime);
    if (!timestamps.has(key)) timestamps.set(key, updated);
  }
  return { rows: extractAmazonInventorySnapshots(value).map(row => ({ ...row, sourceUpdatedAt: timestamps.get(JSON.stringify([row.sellerSku, row.condition])) ?? null })), rawCount: rows.length, nextToken: inventoryNextToken(value) };
}
export function classifySyncFailure(error: unknown): { code: string; retryable: boolean; message: string; retryAfterMs: number } {
  if (error instanceof AmazonSpApiError) return { code: error.status === 429 ? "THROTTLE" : error.status === 401 || error.status === 403 ? "AUTH" : error.retryable ? "TRANSIENT" : "API_REJECTED", retryable: error.retryable,
    message: error.status === 429 ? "Amazon 请求限流，按退避策略重试。" : error.status === 401 || error.status === 403 ? "Amazon 授权不可用，请重新验证授权和域权限。" : error.retryable ? "Amazon 网络或服务暂时异常，按检查点重试。" : "Amazon 拒绝请求，请核对授权、参数或过期分页 token；手动重试将从完整快照重新开始。", retryAfterMs: error.retryAfterMs };
  return { code: "VALIDATION_OR_CONFIGURATION", retryable: false, message: "同步配置、响应完整性或检查点校验失败；未发布新快照。请核对数据源及授权后重试。", retryAfterMs: 0 };
}
async function assertActor(run: AmazonSyncRun) {
  const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: run.organizationId, userId: run.requestedByUserId } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !roleCanPerformAction(member.role, "operations", "create", await getOrganizationRolePermissions(run.organizationId))) throw new Error("任务操作人已停用或不再具备同步权限。");
}
async function assertFence(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const current = await tx.amazonSyncRun.findFirst({ where: { id: run.id, executionVersion: 2, status: "RUNNING", fenceVersion: run.fenceVersion, leaseOwner: run.leaseOwner, leaseExpiresAt: { gt: new Date() } } });
  if (!current) throw new SyncFenceLost();
  return current;
}
async function log(tx: Prisma.TransactionClient, run: AmazonSyncRun, event: string, code?: string) {
  await tx.amazonSyncTaskLog.create({ data: { id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event, stage: run.stage, page: run.pagesCompleted, code } });
}
async function assertLiveSource(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const source = await tx.amazonSyncDataSource.findFirst({ where: { id: run.sourceId!, organizationId: run.organizationId, workspaceId: run.workspaceId, enabled: true }, include: { authorization: true, seller: true } });
  if (!source || source.resource !== run.resource || source.seller.status !== "active" || source.authorization.status !== "CONFIGURED" || source.authorization.revision !== run.authorizationRevision) throw new Error("数据源或授权在同步期间改变。");
  return source;
}
async function stopForControl(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  const current = await assertFence(tx, run);
  if (!current.control) return false;
  await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: current.control === "CANCEL" ? "CANCELLED" : "PAUSED", control: null, leaseOwner: null, leaseExpiresAt: null, finishedAt: current.control === "CANCEL" ? new Date() : null } });
  await log(tx, run, current.control === "CANCEL" ? "CANCELLED" : "PAUSED");
  return true;
}
export async function processSyncCenterTask(runId: string, dispatchVersion: number) {
  const candidate = await prisma.amazonSyncRun.findFirst({ where: { id: runId, executionVersion: 2 } });
  if (!candidate || !syncCenterEnabled(candidate) || candidate.dispatchVersion !== dispatchVersion || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(candidate.status)) return;
  const source = await prisma.amazonSyncDataSource.findFirst({ where: { id: candidate.sourceId!, organizationId: candidate.organizationId, workspaceId: candidate.workspaceId }, include: { authorization: true } });
  if (!source) return;
  // Shared seller + operation lock also serializes requests across marketplaces and task slices.
  await withAmazonSyncLock({ ...candidate, resource: `v2-api:${source.authorization.amazonSellerId}:${candidate.resource}` }, async () => {
    const run = await prisma.$transaction(async tx => {
      await scopeLock(tx, candidate);
      const live = await tx.amazonSyncRun.findUniqueOrThrow({ where: { id: runId } });
      if (live.dispatchVersion !== dispatchVersion || !["WAITING", "QUEUED", "RETRY_WAIT"].includes(live.status) || live.nextAttemptAt > new Date()) return null;
      const first = live.stage === "WAITING" || live.status === "RETRY_WAIT";
      const updated = await tx.amazonSyncRun.update({ where: { id: runId }, data: { status: "RUNNING", leaseOwner: randomUUID(), fenceVersion: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + leaseMs), attempts: first ? { increment: 1 } : undefined, executionStartedAt: live.executionStartedAt ?? new Date(), authorizationRevision: live.authorizationRevision ?? source.authorization.revision, error: null } });
      await log(tx, updated, first ? "ATTEMPT_STARTED" : "SLICE_RESUMED"); return updated;
    });
    if (!run) return;
    await executeSlice(run);
  });
}
async function executeSlice(run: AmazonSyncRun) {
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  try {
    await assertActor(run);
    const source = await prisma.$transaction(tx => assertLiveSource(tx, run));
    const auth = source.authorization;
    officialEndpoint(auth.awsRegion, auth.endpoint); implementedDomain(run.resource);
    const sites = extractMarketplaceParticipations({ payload: auth.marketplaceParticipations });
    if (!sites.some(s => s.marketplaceId === source.marketplaceId)) throw new Error("站点未验证。");
    const events: AmazonRequestEvent[] = [];
    const client = new AmazonSpApiClient({ ...decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: auth.id }), region: auth.awsRegion, endpoint: auth.endpoint }, { onResponse: e => events.push(e) });
    let token = decryptCheckpoint(run.checkpointCiphertext, scope, run.id);
    const operation = run.resource === "inventory" ? "getInventorySummaries" : "searchListingsItems";
    const budgetKey = { ...scope, authorizationId: auth.id, operation };
    for (let slice = 0; slice < pagesPerSlice; slice++) {
      if (!syncCenterEnabled(scope)) throw new Error("试点开关已关闭。");
      if (await prisma.$transaction(async tx => { await scopeLock(tx, scope); return stopForControl(tx, run); })) return;
      if (run.paginationComplete) break;
      if (run.pagesCompleted >= maxPages) throw new Error("超过分页安全上限。");
      const budget = await prisma.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: budgetKey } });
      const wait = Math.max(0, (budget?.nextRequestAt.getTime() ?? 0) - Date.now());
      // A long budget wait releases the worker slot; it does not busy-poll Amazon.
      if (wait > 5000) { await yieldSlice(run, new Date(Date.now() + wait)); return; }
      if (wait) await delay(wait);
      const pageTokenHash = createHash("sha256").update(token ?? "FIRST_PAGE").digest("hex");
      if (await prisma.amazonSyncPage.findUnique({ where: { taskId_tokenHash: { taskId: run.id, tokenHash: pageTokenHash } } })) throw new Error("分页 token 循环。");
      events.length = 0;
      let response: unknown;
      try { response = run.resource === "inventory" ? await client.getInventorySummaries({ marketplaceId: source.marketplaceId, nextToken: token }) : await client.searchListingsItems({ sellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, nextToken: token }); }
      catch (error) { await persistRequests(run, events, budgetKey, error); throw error; }
      await persistRequests(run, events, budgetKey);
      let rows: Array<Prisma.AmazonInventorySnapshotCreateManyInput | Prisma.AmazonCatalogSnapshotCreateManyInput>, nextToken: string | undefined, rawCount: number;
      const capturedAt = new Date();
      if (run.resource === "inventory") {
        const page = validateInventoryPage(response); nextToken = page.nextToken; rawCount = page.rawCount;
        rows = page.rows.map(item => ({ id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku, item.condition])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, syncRunId: run.id, ...item, capturedAt }));
      } else {
        const pagination = (response as { pagination?: unknown })?.pagination;
        if (pagination !== undefined && (!pagination || typeof pagination !== "object" || ("nextToken" in pagination && pagination.nextToken !== undefined && typeof pagination.nextToken !== "string"))) throw new Error("刊登分页结构无效。");
        const page = extractCatalogPage(response, source.marketplaceId); nextToken = page.nextToken?.trim() || undefined; rawCount = page.items.length;
        if (rawCount > 1000) throw new Error("单页超过安全行数限制。");
        const rawItems = (response as { items: { summaries?: { marketplaceId?: string; lastUpdatedDate?: unknown }[] }[] }).items;
        rows = page.items.map((item, index) => ({ sourceUpdatedAt: sourceTimestamp(rawItems[index].summaries?.find(summary => summary.marketplaceId === source.marketplaceId)?.lastUpdatedDate), id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: run.id, ...item, fieldSources: { sellerSku: "Listings Items API", asin: "Listings Items API", listingStatus: "Listings Items API", fulfillmentType: "Listings Items API" }, capturedAt }));
      }
      if (run.processedCount + rawCount > maxRows) throw new Error("超过总行数安全上限。");
      const checkpointCiphertext = encryptCheckpoint(nextToken, scope, run.id);
      const updated = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return null;
        // Staged rows remain invisible until this task becomes the source's published head.
        const inserted = run.resource === "inventory" ? await tx.amazonInventorySnapshot.createMany({ data: rows as Prisma.AmazonInventorySnapshotCreateManyInput[], skipDuplicates: true }) : await tx.amazonCatalogSnapshot.createMany({ data: rows as Prisma.AmazonCatalogSnapshotCreateManyInput[], skipDuplicates: true });
        await tx.amazonSyncPage.create({ data: { ...scope, taskId: run.id, page: run.pagesCompleted + 1, tokenHash: pageTokenHash, rowCount: rawCount } });
        const result = await tx.amazonSyncRun.update({ where: { id: run.id }, data: { pagesCompleted: { increment: 1 }, processedCount: { increment: rawCount }, insertedCount: { increment: inserted.count }, skippedCount: { increment: rawCount - inserted.count }, paginationComplete: !nextToken, checkpointCiphertext, stage: nextToken ? "FETCHING" : "VALIDATING", leaseExpiresAt: new Date(Date.now() + leaseMs) } });
        await log(tx, result, "PAGE_COMMITTED"); return result;
      });
      if (!updated) return;
      Object.assign(run, updated); token = nextToken;
    }
    if (run.paginationComplete) await publish(run); else await yieldSlice(run);
  } catch (error) {
    if (error instanceof SyncFenceLost) return;
    const failure = classifySyncFailure(error);
    await prisma.$transaction(async tx => {
      await scopeLock(tx, scope);
      try { await assertFence(tx, run); } catch (e) { if (e instanceof SyncFenceLost) return; throw e; }
      if (await stopForControl(tx, run)) return;
      const retry = failure.retryable && run.attempts < run.maxAttempts;
      await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: retry ? "RETRY_WAIT" : "FAILED", error: failure.message, finishedAt: retry ? null : new Date(), nextAttemptAt: new Date(Date.now() + retryDelay(run.attempts, failure.retryAfterMs)), leaseOwner: null, leaseExpiresAt: null, dispatchVersion: { increment: 1 } } });
      await log(tx, run, retry ? "RETRY_SCHEDULED" : "FAILED", failure.code);
    });
  }
}
async function persistRequests(run: AmazonSyncRun, events: AmazonRequestEvent[], key: SyncScope & { authorizationId: string; operation: string }, error?: unknown) {
  await prisma.$transaction(async tx => {
    await assertFence(tx, run);
    const logs = events.map(e => ({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: e.operation, stage: "REQUEST", statusCode: e.status, requestId: e.requestId, rateLimit: e.rateLimit }));
    if (error && !events.length) logs.push({ id: randomUUID(), organizationId: run.organizationId, workspaceId: run.workspaceId, taskId: run.id, attempt: run.attempts, event: key.operation, stage: "REQUEST", statusCode: null, requestId: null, rateLimit: null });
    if (logs.length) await tx.amazonSyncTaskLog.createMany({ data: logs });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { apiRequests: { increment: logs.length }, throttles: { increment: events.filter(e => e.status === 429).length }, leaseExpiresAt: new Date(Date.now() + leaseMs) } });
    const limitEvent = [...events].reverse().find(e => e.operation === key.operation && e.rateLimit), observed = limitEvent ? Number(limitEvent.rateLimit) : undefined;
    const existing = await tx.amazonSyncApiBudget.findUnique({ where: { organizationId_workspaceId_authorizationId_operation: key } });
    const limit = observed && Number.isFinite(observed) ? observed : existing?.observedLimit;
    const throttled = error instanceof AmazonSpApiError && error.status === 429;
    const interval = Math.max(1000, limit && limit > 0 ? 1000 / limit : 1000, throttled ? retryDelay(run.attempts, error.retryAfterMs) : 0);
    const nextRequestAt = new Date(Date.now() + Math.min(interval, 60 * 60_000));
    await tx.amazonSyncApiBudget.upsert({ where: { organizationId_workspaceId_authorizationId_operation: key }, create: { ...key, nextRequestAt, observedLimit: limit }, update: { nextRequestAt, observedLimit: limit } });
  });
}
async function yieldSlice(run: AmazonSyncRun, nextAttemptAt = new Date()) {
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run); await assertFence(tx, run);
    if (await stopForControl(tx, run)) return;
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "WAITING", stage: run.paginationComplete ? "VALIDATING" : "FETCHING", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt, dispatchVersion: { increment: 1 } } });
  });
}
async function publish(run: AmazonSyncRun) {
  await assertActor(run);
  await prisma.$transaction(async tx => {
    await scopeLock(tx, run); await assertFence(tx, run); const source = await assertLiveSource(tx, run);
    if (await stopForControl(tx, run)) return;
    if (!syncCenterEnabled(run) || !run.paginationComplete || !run.pagesCompleted) throw new Error("未完整抓取全部页。");
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    const pageCount = await tx.amazonSyncPage.count({ where: { ...scope, taskId: run.id } });
    const rowCount = run.resource === "inventory" ? await tx.amazonInventorySnapshot.count({ where: { ...scope, syncRunId: run.id } }) : await tx.amazonCatalogSnapshot.count({ where: { ...scope, sourceRunId: run.id } });
    if (pageCount !== run.pagesCompleted || rowCount !== run.insertedCount || rowCount + run.skippedCount !== run.processedCount) throw new Error("分页和记录数量不一致。");
    const finishedAt = new Date();
    const coverage = { type: "complete_snapshot", capturedFrom: run.executionStartedAt!.toISOString(), capturedTo: finishedAt.toISOString(), paginationComplete: true, rowCount, validationVersion: "amazon-sync.v1", sourceUpdatedAt: null };
    await tx.amazonSyncDataSource.update({ where: { id: source.id }, data: { activeRunId: run.id, lastSuccessAt: finishedAt, rowCount, coverage } });
    await tx.amazonSyncRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", stage: "COMPLETED", finishedAt, leaseOwner: null, leaseExpiresAt: null, checkpointCiphertext: null, summary: { provider: "amazon_sp_api", executionVersion: 2, coverage, snapshotCount: rowCount, outcomes: [{ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, count: rowCount }] } } });
    await log(tx, run, "PUBLISHED");
  });
}
