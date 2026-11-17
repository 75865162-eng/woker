import { registerArchivedFields } from "./field-registry";
import { rawResponseEnvelope } from "./raw-fields";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, type AmazonSyncRun } from "@prisma/client";
import { AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { extractAmazonInventorySnapshots } from "@/lib/amazon/inventory";
import { extractCatalogPage, listingSummaryParserVersion } from "@/lib/amazon/catalog";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint";
import { syncCenterEnabled, SyncInputError } from "./policy";
import { canonical, seal, unseal } from "./approval-policy";
import { assertConsistentSnapshotRows } from "./snapshot-consistency";
import type { SyncProcessorRuntime, SyncProcessorSource } from './processor-runtime';

export function inventoryNextToken(value: unknown) {
  const record = value as { pagination?: { nextToken?: unknown } };
  if (record && record.pagination === undefined) return undefined;
  if (!record || !record.pagination || typeof record.pagination !== "object" || Array.isArray(record.pagination) || (record.pagination.nextToken !== undefined && typeof record.pagination.nextToken !== "string")) throw new Error("分页结构无效。");
  return record.pagination.nextToken?.trim() || undefined;
}

export function sourceTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("数据源更新时间无效。");
  return new Date(value);
}

export function validateInventoryPage(value: unknown) {
  const root = value as { payload?: { inventorySummaries?: unknown }; inventorySummaries?: unknown };
  const rows = root?.payload?.inventorySummaries ?? root?.inventorySummaries;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || typeof row.sellerSku !== "string" || !row.sellerSku.trim())) throw new Error("库存页缺少关键字段；不能发布不完整快照。");
  if (rows.length > 1000) throw new Error("单页超过安全行数限制。");
  const timestamps = new Map<string, Date | null>(), evidence = new Map<string, string>();
  for (const raw of rows as Record<string, unknown>[]) {
    const key = JSON.stringify([String(raw.sellerSku).trim().slice(0, 500), typeof raw.condition === "string" ? raw.condition.trim().slice(0, 500) : ""]);
    const updated = sourceTimestamp(raw.lastUpdatedTime);
    // Validate every row, including duplicates; the legacy extractor keeps only the first.
    const normalized = extractAmazonInventorySnapshots({ inventorySummaries: [raw] })[0];
    const signature = canonical({ ...normalized, sourceUpdatedAt: updated?.toISOString() ?? null });
    if (evidence.has(key) && evidence.get(key) !== signature) throw new Error("库存重复业务键包含冲突数据，不能发布完整快照。");
    evidence.set(key, signature);
    if (String(raw.sellerSku).trim().length > 500 || (typeof raw.condition === "string" && raw.condition.trim().length > 500)) throw new Error("库存业务键超长，不能截断保存。");
    if (!timestamps.has(key)) timestamps.set(key, updated);
  }
  return { rows: extractAmazonInventorySnapshots(value).map(row => ({ ...row, sourceUpdatedAt: timestamps.get(JSON.stringify([row.sellerSku, row.condition])) ?? null })), rawCount: rows.length, nextToken: inventoryNextToken(value) };
}

export function validateCatalogPage(response: unknown, marketplaceId: string) {
  const page = extractCatalogPage(response, marketplaceId);
  const rawItems = (response as { items: Array<{ sku: string; summaries?: unknown }> }).items;
  for (const item of rawItems) {
    if (item.sku.length > 500 || !Array.isArray(item.summaries)) throw new Error("刊登业务键或站点摘要无效。");
    const matches = item.summaries.filter((v: unknown) => v && typeof v === "object" && (v as { marketplaceId?: unknown }).marketplaceId === marketplaceId);
    if (matches.length !== 1) throw new Error("刊登缺少唯一的目标站点摘要。");
    const summary = matches[0] as { asin?: unknown; status?: unknown };
    if (summary.asin !== undefined && typeof summary.asin !== "string") throw new Error("刊登 ASIN 格式无效。");
    if (summary.status !== undefined && (!Array.isArray(summary.status) || summary.status.some((v: unknown) => typeof v !== "string"))) throw new Error("刊登状态格式无效。");
  }
  assertConsistentSnapshotRows(page.items, "catalog");
  return page;
}

export function validateCatalogCompletion(response: unknown, processedCount: number, hasNextPage: boolean) {
  const total = (response as { numberOfResults?: unknown })?.numberOfResults;
  if (total !== undefined && (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0)) throw new Error("刊登结果总数无效。");
  if (!hasNextPage && typeof total === "number" && total > processedCount) throw new Error("刊登搜索结果未覆盖报告总数；不能发布完整快照。");
}

export function createSnapshotProcessor(runtime: Pick<SyncProcessorRuntime, "prisma" | "leaseMs" | "maxPages" | "maxRows" | "scopeLock" | "assertActor" | "assertFence" | "assertLiveSource" | "stopForControl" | "yieldSlice" | "log" | "persistRequests" | "fenceLost">) {
  const { prisma, leaseMs, maxPages, maxRows, scopeLock, assertActor, assertFence, assertLiveSource, stopForControl, yieldSlice, log, persistRequests, fenceLost } = runtime;
  const pagesPerSlice = 5;
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
  return async function executeSnapshotSlice(run: AmazonSyncRun, client: AmazonSpApiClient, events: AmazonRequestEvent[], source: SyncProcessorSource) {
    const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
    const auth = source.authorization;
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
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) throw fenceLost();
      });
      const pageTokenHash = createHash("sha256").update(token ?? "FIRST_PAGE").digest("hex");
      if (await prisma.amazonSyncPage.findUnique({ where: { taskId_tokenHash: { taskId: run.id, tokenHash: pageTokenHash } } })) throw new Error("分页 token 循环。");
      events.length = 0;
      let response: unknown, rawBody = "";
      const captureRaw = (text: string) => { rawBody = text; };
      const rawGeneration = (run.frozenScope as { rawGeneration?: number }).rawGeneration ?? 0;
      const archivedPage = await prisma.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: run.resource,
        ...(rawGeneration === 0 ? { page: run.pagesCompleted + 1 } : { AND: [{ requestMetadata: { path: ["snapshotGeneration"], equals: rawGeneration } }, { requestMetadata: { path: ["pageTokenHash"], equals: pageTokenHash } }] }) } });
      try {
        if (archivedPage) {
          const envelope = unseal(archivedPage.rawCiphertext, scope, `${run.id}:${archivedPage.page}`, `amazon-${run.resource}-raw.v1`);
          if (typeof envelope.rawBody !== "string" || createHash("sha256").update(envelope.rawBody).digest("hex") !== archivedPage.bodySha256 || (archivedPage.requestMetadata as { pageTokenHash?: string }).pageTokenHash !== pageTokenHash) throw new SyncInputError("快照原件或分页身份校验失败。");
          rawBody = envelope.rawBody; response = JSON.parse(rawBody);
        } else response = run.resource === "inventory" ? await client.getInventorySummaries({ marketplaceId: source.marketplaceId, nextToken: token }, captureRaw) : await client.searchListingsItems({ sellerId: auth.amazonSellerId, marketplaceId: source.marketplaceId, nextToken: token }, captureRaw);
      }
      catch (error) { await persistRequests(run, events, budgetKey, error); throw error; }
      await persistRequests(run, events, budgetKey);
      if (!rawBody) throw new SyncInputError("Amazon 未返回可追溯原始响应，未提交快照。");
      // Archive before parsing: a contract failure must not discard unknown fields.
      await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        const last = !archivedPage ? await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, page: { gt: 0 } }, orderBy: { page: "desc" }, select: { page: true } }) : null;
        const page = archivedPage?.page ?? (last?.page ?? 0) + 1;
        if (!archivedPage) await tx.amazonSyncRawPage.create({ data: { ...scope, taskId: run.id, page, resource: run.resource, requestMetadata: { apiVersion: run.resource === "inventory" ? "v1" : "2021-08-01", operation, marketplaceId: source.marketplaceId, pageTokenHash, snapshotGeneration: rawGeneration, logicalPage: run.pagesCompleted + 1 }, rawCiphertext: seal(rawResponseEnvelope(rawBody, operation), scope, `${run.id}:${page}`, `amazon-${run.resource}-raw.v1`), bodySha256: createHash("sha256").update(rawBody).digest("hex"), capturedAt: new Date() } });
        await registerArchivedFields(tx, run, page, rawBody, "JSON");
      });
      let rows: Array<Prisma.AmazonInventorySnapshotCreateManyInput | Prisma.AmazonCatalogSnapshotCreateManyInput>, nextToken: string | undefined, rawCount: number;
      const capturedAt = new Date();
      if (run.resource === "inventory") {
        const page = validateInventoryPage(response); nextToken = page.nextToken; rawCount = page.rawCount;
        rows = page.rows.map(item => ({ id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku, item.condition])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, syncRunId: run.id, ...item, capturedAt }));
      } else {
        const pagination = (response as { pagination?: unknown })?.pagination;
        if (pagination !== undefined && (!pagination || typeof pagination !== "object" || Array.isArray(pagination) || ("nextToken" in pagination && pagination.nextToken !== undefined && typeof pagination.nextToken !== "string"))) throw new Error("刊登分页结构无效。");
        const page = validateCatalogPage(response, source.marketplaceId); nextToken = page.nextToken?.trim() || undefined; rawCount = page.items.length;
        validateCatalogCompletion(response, run.processedCount + rawCount, !!nextToken);
        if (rawCount > 1000) throw new Error("单页超过安全行数限制。");
        const rawItems = (response as { items: { summaries?: { marketplaceId?: string; lastUpdatedDate?: unknown }[] }[] }).items;
        rows = page.items.map((item, index) => ({ sourceUpdatedAt: sourceTimestamp(rawItems[index].summaries?.find(summary => summary.marketplaceId === source.marketplaceId)?.lastUpdatedDate), id: createHash("sha256").update(JSON.stringify([run.id, item.sellerSku])).digest("hex"), ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: run.id, ...item, fieldSources: { sellerSku: "Listings Items API", asin: "Listings Items API", listingStatus: "Listings Items API", fulfillmentType: "Listings Items API", ...(item.listingAttributes ? { listingAttributes: "Listings Items API:summaries", listingAttributesParserVersion: listingSummaryParserVersion } : {}) }, capturedAt }));
      }
      if (run.processedCount + rawCount > maxRows) throw new Error("超过总行数安全上限。");
      const checkpointCiphertext = encryptCheckpoint(nextToken, scope, run.id);
      const updated = await prisma.$transaction(async tx => {
        await scopeLock(tx, scope); await assertFence(tx, run); await assertLiveSource(tx, run);
        if (await stopForControl(tx, run)) return null;
        // Identical overlapping pages deduplicate; conflicting observations cannot masquerade as complete.
        const previous = run.resource === "inventory"
          ? await tx.amazonInventorySnapshot.findMany({ where: { ...scope, syncRunId: run.id, sellerSku: { in: rows.map(row => row.sellerSku) } } })
          : await tx.amazonCatalogSnapshot.findMany({ where: { ...scope, sourceRunId: run.id, sellerSku: { in: rows.map(row => row.sellerSku) } } });
        assertConsistentSnapshotRows([...previous, ...rows], run.resource);
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
  };
}
