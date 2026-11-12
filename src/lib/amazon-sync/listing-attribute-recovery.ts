import { extractCatalogPage, listingSummaryParserVersion } from "@/lib/amazon/catalog";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { approvedContext } from "./approved-context";
import { digest } from "./approval-policy";
import { assertAmazonScopeAdmin } from "./data-access";
import { previewFieldArchiveRecovery } from "./field-archive-recovery";
import { SyncInputError, type SyncScope } from "./policy";

function object(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("Listing 属性或来源结构无效。", 409);
  return value as Record<string, unknown>;
}

type RecoverySource = Awaited<ReturnType<typeof previewFieldArchiveRecovery>>["source"];
type RecoveryTask = Awaited<ReturnType<typeof previewFieldArchiveRecovery>>["task"];
function assertListingRecoveryTask(source: RecoverySource, task: RecoveryTask) {
  const frozen = object(task.frozenScope);
  if (source.resource !== "catalog" || task.status !== "SUCCEEDED" || !task.finishedAt || task.stage === "PURGED"
    || frozen.resource !== "catalog" || frozen.authorizationId !== source.authorizationId || frozen.sellerAccountId !== source.sellerAccountId || frozen.marketplaceId !== source.marketplaceId
    || frozen.amazonSellerId !== source.authorization.amazonSellerId || (frozen.region !== undefined && frozen.region !== source.authorization.awsRegion)) {
    throw new SyncInputError("仅可补齐同账号、同站点、已成功的 Listing API 快照。", 409);
  }
}

async function listingRecoveryTask(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string) {
  const source = await tx.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId }, select: { id: true, revision: true, resource: true, sellerAccountId: true, marketplaceId: true, authorizationId: true, authorization: { select: { revision: true, amazonSellerId: true, awsRegion: true } } } });
  const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, sourceId, resource: "catalog", executionVersion: 2 } });
  if (!source || !task) throw new SyncInputError("Listing 任务不可访问。", 403);
  assertListingRecoveryTask(source, task);
  return { source, task };
}

/** Read metadata only. Physical archive pages can be sparse after retries. */
export async function listListingAttributeRecoveryPages(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0 || after > 2147483647) throw new SyncInputError("原件分页游标无效。");
  const { source, task } = await listingRecoveryTask(tx, scope, sourceId, taskId);
  const generation = object(task.frozenScope).rawGeneration ?? 0;
  const rows = await tx.amazonSyncRawPage.findMany({ where: { ...scope, taskId, resource: "catalog", page: { gt: after }, AND: [
    { requestMetadata: { path: ["operation"], equals: "searchListingsItems" } },
    { requestMetadata: { path: ["apiVersion"], equals: "2021-08-01" } },
    { requestMetadata: { path: ["marketplaceId"], equals: source.marketplaceId } },
  ] }, select: { page: true, requestMetadata: true }, orderBy: { page: "asc" }, take: 101 });
  const pages: number[] = [];
  let examined = 0, cursor = after;
  for (const row of rows.slice(0, 100)) {
    examined++; cursor = row.page;
    if ((object(row.requestMetadata).snapshotGeneration ?? 0) === generation) pages.push(row.page);
    if (pages.length === 2) break;
  }
  const hasNext = rows.length > examined;
  return { pages, nextCursor: hasNext ? cursor : null, hasNext, batchSize: 2, rawValuesIncluded: false, started: false };
}

export async function readListingAttributeRecoveryPages(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId"), after = params.get("after") ?? "0";
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || !/^\d+$/.test(after)) throw new SyncInputError("须指定唯一来源、任务和有效游标。");
  for (const key of ["sourceId", "taskId", "after"]) if (params.getAll(key).length > 1) throw new SyncInputError("分页参数不能重复。");
  const result = await prisma.$transaction(tx => listListingAttributeRecoveryPages(tx, scope, sourceId, taskId, Number(after)));
  await assertAmazonScopeAdmin(scope, actor);
  return result;
}

/** Persisted approvals are the batch history; browser progress never proves application. */
export async function readListingAttributeRecoveryHistory(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId");
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || params.getAll("sourceId").length !== 1 || params.getAll("taskId").length !== 1) throw new SyncInputError("须指定唯一来源和任务。");
  const result = await prisma.$transaction(async tx => {
    // Reuse live identity and frozen task validation; no raw body is decrypted.
    await listingRecoveryTask(tx, scope, sourceId, taskId);
    const rows = await tx.amazonDataCenterChangeRequest.findMany({ where: { ...scope, operation: "recover-report", targetId: sourceId,
      AND: [{ beforeSummary: { path: ["current", "taskId"], equals: taskId } }, { beforeSummary: { path: ["current", "mode"], equals: "LISTING_SUMMARY_FILL_MISSING_ONLY" } }, { beforeSummary: { path: ["current", "sourceId"], equals: sourceId } }],
    }, select: { id: true, status: true, createdAt: true, appliedAt: true, expiresAt: true, beforeSummary: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21 });
    const now = Date.now();
    return { batches: rows.slice(0, 20).map(row => {
      const manifest = object(object(row.beforeSummary).current);
      const archives = Array.isArray(manifest.archives) ? manifest.archives : [];
      const pages = archives.map(archive => object(archive).page);
      if (!pages.length || pages.length > 10 || pages.some(page => !Number.isSafeInteger(page) || Number(page) < 1)) throw new SyncInputError("补齐批次原件页记录无效。", 409);
      return { id: row.id, status: ["REQUESTED", "APPROVED"].includes(row.status) && row.expiresAt.getTime() <= now ? "EXPIRED" : row.status,
        createdAt: row.createdAt.toISOString(), appliedAt: row.appliedAt?.toISOString() ?? null, pages: pages as number[],
        checkedRows: typeof manifest.checkedRows === "number" ? manifest.checkedRows : null,
        changedRows: typeof manifest.changedRows === "number" ? manifest.changedRows : null };
    }), hasMore: rows.length > 20, started: false, rawValuesIncluded: false };
  });
  await assertAmazonScopeAdmin(scope, actor);
  return result;
}

/** Fill missing summary fields only, in existing successful API snapshots.
 * Preview hashes bind exact raw bytes, parser and existing business versions.
 * Neither preview nor apply requests Amazon or changes publication/cursors. */
export async function previewListingAttributeRecovery(tx: Prisma.TransactionClient, scope: SyncScope, sourceId: string, taskId: string, pages: unknown) {
  const scan = await previewFieldArchiveRecovery(tx, scope, sourceId, taskId, pages);
  const { source, task } = scan;
  const frozen = object(task.frozenScope);
  assertListingRecoveryTask(source, task);
  const parsed = new Map<string, ReturnType<typeof extractCatalogPage>["items"][number]>();
  for (const archive of scan.archives) {
    const metadata = object(archive.raw.requestMetadata);
    if (archive.format !== "JSON" || archive.raw.page < 1 || metadata.operation !== "searchListingsItems" || metadata.apiVersion !== "2021-08-01"
      || metadata.marketplaceId !== source.marketplaceId || (metadata.snapshotGeneration ?? 0) !== (frozen.rawGeneration ?? 0)) {
      throw new SyncInputError("Listing 原件操作、版本、站点或快照代次不匹配。", 409);
    }
    const body = JSON.parse(archive.text);
    const items = extractCatalogPage(body, source.marketplaceId).items;
    if (items.length > 1000) throw new SyncInputError("Listing 原件单页超容量。", 409);
    for (const rawItem of body.items) {
      if (!Array.isArray(rawItem.summaries) || rawItem.summaries.filter((item: unknown) => object(item).marketplaceId === source.marketplaceId).length !== 1) throw new SyncInputError("Listing 原件缺少唯一目标站点摘要。", 409);
    }
    for (const item of items) {
      const previous = parsed.get(item.sellerSku);
      if (previous && digest(previous) !== digest(item)) throw new SyncInputError("Listing 原件同 SKU 属性冲突。", 409);
      parsed.set(item.sellerSku, item);
      if (parsed.size > 200) throw new SyncInputError("单次属性补齐最多 200 个 SKU，请缩小原件页范围。", 409);
    }
  }
  const rows = parsed.size ? await tx.amazonCatalogSnapshot.findMany({ where: { ...scope, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceRunId: task.id, sellerSku: { in: [...parsed.keys()] } }, orderBy: { id: "asc" } }) : [];
  if (rows.length !== parsed.size) throw new SyncInputError("Listing 原件与现有快照行不完整匹配。", 409);
  const candidates = rows.map(row => {
    const item = parsed.get(row.sellerSku)!;
    if (row.asin !== item.asin || row.listingStatus !== item.listingStatus || row.fulfillmentType !== item.fulfillmentType) throw new SyncInputError("Listing 原件与快照基础字段不一致。", 409);
    const attributes = object(row.listingAttributes), fieldSources = object(row.fieldSources);
    const additions: Record<string, string> = {};
    for (const [key, value] of Object.entries(item.listingAttributes ?? {})) {
      if (value == null) continue;
      if (attributes[key] != null && attributes[key] !== value) throw new SyncInputError("Listing 已有属性与原件冲突，未覆盖现有数据。", 409);
      if (attributes[key] == null) additions[key] = value;
    }
    return { row, additions, attributes: { ...attributes, ...additions }, fieldSources };
  });
  const manifest = { ...scan.manifest, businessFactsModified: candidates.some(item => Object.keys(item.additions).length > 0), mode: "LISTING_SUMMARY_FILL_MISSING_ONLY", parserVersion: listingSummaryParserVersion,
    checkedRows: rows.length, changedRows: candidates.filter(item => Object.keys(item.additions).length).length,
    addedFields: candidates.reduce((sum, item) => sum + Object.keys(item.additions).length, 0),
    rowVersions: candidates.map(({ row, additions }) => ({ id: row.id, version: row.dataVersion, beforeDigest: digest({ attributes: row.listingAttributes, fieldSources: row.fieldSources }), additionsDigest: digest(additions) })) };
  return { source, task, candidates, manifest, recoveryDigest: digest(manifest) };
}

export async function readListingAttributeRecoveryPreview(scope: SyncScope, actor: string, params: URLSearchParams) {
  await assertAmazonScopeAdmin(scope, actor);
  const sourceId = params.get("sourceId"), taskId = params.get("taskId"), pages = params.get("rawPages");
  if (!sourceId || sourceId.length > 200 || !taskId || taskId.length > 200 || !pages || !/^\d+(?:,\d+){0,9}$/.test(pages)) throw new SyncInputError("须指定 sourceId、taskId 和逗号分隔原件页。");
  const preview = await prisma.$transaction(tx => previewListingAttributeRecovery(tx, scope, sourceId, taskId, pages.split(",").map(Number)));
  await assertAmazonScopeAdmin(scope, actor);
  return { manifest: preview.manifest, recoveryDigest: preview.recoveryDigest, started: false, rawValuesIncluded: false,
    command: { action: "recover-report", id: sourceId, revision: preview.source.revision, taskId, rawPages: preview.manifest.archives.map(item => item.page), listingAttributesOnly: true, recoveryDigest: preview.recoveryDigest } };
}

export async function applyListingAttributeRecovery(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  const { tx, approvalId } = approvedContext(scope, "recover-report");
  const preview = await previewListingAttributeRecovery(tx, scope, String(command.id), String(command.taskId), command.rawPages);
  if (preview.source.revision !== command.revision || preview.recoveryDigest !== command.recoveryDigest) throw new SyncInputError("Listing 补齐清单或数据版本已变化。", 409);
  for (const item of preview.candidates) {
    if (!Object.keys(item.additions).length) continue;
    const updated = await tx.amazonCatalogSnapshot.updateMany({ where: { ...scope, id: item.row.id, dataVersion: item.row.dataVersion, sourceRunId: preview.task.id }, data: {
      listingAttributes: item.attributes as Prisma.InputJsonObject, dataVersion: { increment: 1 },
      fieldSources: { ...item.fieldSources, listingSummaryRecovery: { parserVersion: listingSummaryParserVersion, approvalId, rawTaskId: preview.task.id, fields: Object.keys(item.additions).sort() } } as Prisma.InputJsonObject,
    } });
    if (updated.count !== 1) throw new SyncInputError("Listing 快照版本已变化。", 409);
  }
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.sync.listing.attributes-recovered", entityType: "AmazonSyncDataSource", entityId: preview.source.id,
    metadata: { workspaceId: scope.workspaceId, approvalId, manifest: preview.manifest, recoveryDigest: preview.recoveryDigest } } });
  return { id: preview.source.id, changedRows: preview.manifest.changedRows, addedFields: preview.manifest.addedFields };
}
