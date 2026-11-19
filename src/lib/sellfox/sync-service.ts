import { syncSellfoxOrders, type OrderCheckpoint } from "./order-sync";
import { syncSellfoxFbaShipments, type FbaShipmentCheckpoint } from "./fba-shipment-sync";
import { syncSellfoxListings, type ListingCheckpoint } from "./listing-sync";
import { syncSellfoxAdsReports } from "./ads-report-sync";
import { claimSellfoxRun, fenceSellfoxRun, finishSellfoxRun, SellfoxLeaseLostError, type SellfoxRunLease } from "@/lib/sellfox/run-lease";
import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots, type PerformanceCheckpoint } from "@/lib/sellfox/product-performance";
import { sellfoxPost } from "@/lib/sellfox/client";
import { isSellfoxSyncResource, isSellfoxEndpointResource, sellfoxEndpointCode, normalizeSellfoxDates, sellfoxReportDates, sellfoxDateAt, SellfoxSyncInputError, nextSellfoxPage, sellfoxSyncResources, sellfoxSyncDisabledReason, SellfoxSyncUnavailableError, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { sellfoxAdsAllowedAdTypes } from "@/lib/sellfox/sync-rules";
import { syncSellfoxSnapshotStores, type SnapshotCheckpoint } from "@/lib/sellfox/snapshot-sync";
import { withSellfoxCredentialScope } from "./credential-context";
import { buildRunShards, recordSellfoxShards, refreshSellfoxCoverage } from "@/lib/sellfox/sync-shards";
import { syncSellfoxGenericEndpoint, type SellfoxEndpointConfig } from "@/lib/sellfox/generic-endpoint-sync";
import { buildSellfoxReconciliation } from "@/lib/sellfox/reconciliation";
import { invalidateHubOverview } from "@/lib/sellfox/hub-overview-cache";
import { markRunWaitingDependency, sellfoxStoresReady } from "@/lib/sellfox/sync-dependency";
import { wakeWaitingDependents } from "@/lib/sellfox/sync-orchestrator";
import { invalidateSellfoxSyncResource } from "@/lib/sellfox/result-cache";
import { runPostSyncProjections } from "@/lib/sellfox/post-sync-projections";

function endpointConfig(row: {
  code: string; label: string; path: string; dateMode: string; scopeMode: string;
  chunkDays: number; pageSize: number; rowsPath: string; idFields: string; params: string; dateFormat: string; maxRows: number;
}): SellfoxEndpointConfig {
  const dateMode = ["none", "current", "range"].includes(row.dateMode) ? row.dateMode as SellfoxEndpointConfig["dateMode"] : "range";
  return {
    code: row.code, label: row.label, path: row.path, dateMode,
    scopeMode: row.scopeMode === "global" ? "global" : "store",
    chunkDays: row.chunkDays, pageSize: row.pageSize, rowsPath: row.rowsPath,
    idFields: row.idFields, params: row.params, dateFormat: row.dateFormat || "yyyy-MM-dd", maxRows: row.maxRows,
  };
}

export const sellfoxResources = sellfoxSyncResources;
export type SyncResource = SellfoxSyncResource | `endpoint:${string}`;
type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}
function rowsFrom(value: unknown): RecordLike[] {
  if (Array.isArray(value)) {
    if (value.some((row) => !asRecord(row))) throw new SellfoxSyncInputError("赛狐列表含有无效记录。");
    return value as RecordLike[];
  }
  const record = asRecord(value);
  if (!record) throw new SellfoxSyncInputError("赛狐列表响应结构无法识别。");
  for (const key of ["rows", "records", "list", "itemList", "data", "result"]) {
    const nested = record[key];
    if (Array.isArray(nested) || asRecord(nested)) return rowsFrom(nested);
  }
  throw new SellfoxSyncInputError("赛狐列表响应缺少有效记录列表。");
}
function field(row: RecordLike, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function num(row: RecordLike, ...keys: string[]): number | null {
  const value = field(row, ...keys);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function pageCount(payload: unknown) {
  const record = asRecord(payload);
  const totalPage = Number(record?.totalPage ?? asRecord(record?.data)?.totalPage);
  const totalSize = Number(record?.totalSize ?? asRecord(record?.data)?.totalSize);
  if (Number.isFinite(totalPage) && totalPage > 0) return Math.floor(totalPage);
  if (Number.isFinite(totalSize) && totalSize >= 0) return Math.ceil(totalSize / 100);
  return null;
}

type SyncInput = { organizationId: string; workspaceId: string; runId: string; userId: string; resource: SyncResource; shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string; backfillFrom?: string; backfillTo?: string; lease: SellfoxRunLease };

async function saveProgress(input: SyncInput, summary: Record<string, unknown>, db?: Pick<Prisma.TransactionClient, "sellfoxSyncRun">) {
  if (!db) return prisma.$transaction(async (tx) => { await saveProgress(input, summary, tx); });
  await fenceSellfoxRun(input.lease, db);
  const current = await db.sellfoxSyncRun.findUnique({ where: { id: input.runId }, select: { summary: true } });
  const request = (current?.summary ?? {}) as Record<string, unknown>;
  await db.sellfoxSyncRun.update({ where: { id: input.runId }, data: { summary: { ...request, progress: summary } as Prisma.InputJsonValue } });
}

async function storesFor(input: SyncInput) {
  return prisma.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(input.shopExternalIds?.length ? { externalId: { in: input.shopExternalIds } } : {}) },
    orderBy: { externalId: "asc" },
  });
}

async function syncStores(input: SyncInput) {
  let count = Math.max(0, Number(input.progress?.count) || 0);
  const cursor = asRecord(input.progress?.cursor);
  if (cursor?.done === true) return count;
  const resumePage = Number(cursor?.pageNo ?? input.progress?.pageNo ?? 1);
  if (!Number.isInteger(resumePage) || resumePage < 1 || resumePage > 1_000) throw new SellfoxSyncInputError("店铺同步断点页码无效。");
  for (let pageNo = resumePage; pageNo <= 1_000; pageNo += 1) {
    const payload = await sellfoxPost<unknown>("/api/shop/pageList.json", { pageNo: String(pageNo), pageSize: "100" });
    const rows = rowsFrom(payload);
    const identities = rows.map((row) => field(row, "shopId", "id", "storeId"));
    if (identities.some((id) => !id) || new Set(identities).size !== identities.length) throw new SellfoxSyncInputError("店铺响应缺少唯一店铺身份。");
    const nextPage = nextSellfoxPage(rows.length, pageNo, pageCount(payload), 100, 1_000);
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]; const externalId = identities[index]; const now = new Date();
        const data = { name: field(row, "shopName", "name", "storeName"), sellerAccountId: field(row, "sellerId", "sellerAccountId") || null, marketplace: field(row, "marketplace", "marketplaceName", "marketplaceId"), country: field(row, "country", "countryName"), status: field(row, "status", "shopStatus"), payload: row as Prisma.InputJsonValue, lastSyncedAt: now, updatedAt: now };
        await tx.sellfoxStore.upsert({
          where: { organizationId_workspaceId_externalId: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId } },
          create: { id: `sellfox-store-${input.organizationId}-${input.workspaceId}-${externalId}`, organizationId: input.organizationId, workspaceId: input.workspaceId, externalId, ...data }, update: data,
        });
      }
      await saveProgress(input, { count: count + rows.length, pageNo, cursor: { pageNo: nextPage ?? pageNo, done: nextPage === null } }, tx);
    });
    count += rows.length;
    if (nextPage === null) break;
  }
  return count;
}

async function syncSnapshots(input: SyncInput) {
  if (input.resource !== "inventory" && input.resource !== "sales") throw new SellfoxSyncInputError("快照资源无效。");
  const dates = input.resource === "inventory" ? [input.reportDate!] : [...new Set([...sellfoxReportDates(input.startDate!, input.endDate!), ...(input.backfillFrom && input.backfillTo ? sellfoxReportDates(input.backfillFrom, input.backfillTo) : [])])];
  let writes = 0; let storeCount = 0; const failures: boolean[] = [];
  for (const date of dates) {
    const latest = await prisma.sellfoxSyncRun.findUnique({ where: { id: input.runId }, select: { summary: true } });
    const states = asRecord(asRecord(asRecord(latest?.summary)?.progress)?.snapshots) ?? {};
    try {
    const result = await syncSellfoxSnapshotStores({
      resource: input.resource, organizationId: input.organizationId, workspaceId: input.workspaceId,
      shopExternalIds: input.shopExternalIds!, reportDate: date, capturedAt: input.capturedAt!,
      checkpoint: states[date] as SnapshotCheckpoint | undefined,
      onProgress: async (update, tx) => {
        const db = tx ?? prisma;
        const current = await db.sellfoxSyncRun.findUnique({ where: { id: input.runId }, select: { summary: true } });
        const progress = asRecord(asRecord(current?.summary)?.progress) ?? {};
        const checkpoints = { ...asRecord(progress.snapshots), [date]: update.checkpoint };
        const count = Object.values(checkpoints).reduce<number>((sum, checkpoint) => sum + Object.values((checkpoint as SnapshotCheckpoint).stores).reduce((value, store) => value + Object.values(store).reduce((total, metric) => total + (metric?.writes ?? 0), 0), 0), 0);
        await saveProgress(input, { ...progress, reportDate: date, snapshots: checkpoints, count }, db);
      },
    });
    writes += result.writes; storeCount = Math.max(storeCount, result.storeCount);
    } catch (error) {
      if (!(error instanceof SellfoxStoreSyncError)) throw error;
      failures.push(error.retryable);
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个日期含失败采集单元，其余日期和店铺已继续；补数游标未推进。`, failures.some(Boolean));
  return { startDate: dates[0], endDate: dates[dates.length - 1], storeCount, writes };
}

export function parseSellfoxHourlyMetric(metric: RecordLike) {
  const required = (keys: string[], integer = false, max = Number.MAX_SAFE_INTEGER) => {
    const value = num(metric, ...keys);
    if (value === null || value < 0 || value > max || (integer && !Number.isInteger(value))) {
      throw new SellfoxSyncInputError(`NEEDS_DATA：小时广告 ${keys[0]} 缺失或无效。`);
    }
    return value;
  };
  return {
    hour: required(["hour", "reportHour", "timeHour"], true, 23),
    impressions: required(["impressions"], true), clicks: required(["clicks"], true),
    cost: required(["cost", "costs", "spend"]), sales: required(["sales", "salesAmount"]),
    orders: required(["orders", "purchases"], true),
  };
}

async function syncHourly(input: SyncInput) {
  const stores = await storesFor(input); let count = 0; const reportDate = input.reportDate ?? defaultSellfoxReportDate();
  for (const store of stores) {
    const campaigns = rowsFrom(await sellfoxPost<unknown>("/api/cpc/manageData/spCampaign.json", { shopId: store.externalId, pageSize: 100 }));
    for (const campaign of campaigns.slice(0, 5)) {
      const campaignId = field(campaign, "campaignId", "id"); if (!campaignId) continue;
      const metrics = rowsFrom(await sellfoxPost<unknown>("/api/cpc/hourData/spCampaign.json", { aggregationType: "campaign", shopId: store.externalId, date: reportDate, campaignId }));
      for (const metric of metrics) {
        const { hour, ...observed } = parseSellfoxHourlyMetric(metric);
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await fenceSellfoxRun(input.lease, tx);
          await tx.sellfoxHourlyMetric.upsert({
          where: { storeId_reportDate_hour_adType_entityType_entityId: { storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId } },
          create: { id: `sellfox-hourly-${store.id}-${reportDate}-${hour}-sp-campaign-${campaignId}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId, entityName: field(campaign, "campaignName", "name"), ...observed, payload: metric as Prisma.InputJsonValue },
          update: { ...observed, payload: metric as Prisma.InputJsonValue, syncedAt: now },
          });
        }); count += 1;
      }
    }
  }
  return { count, storeCount: stores.length, reportDate, depth: "first five SP campaigns per store" };
}

export async function processSellfoxSyncRun(runId: string) {
  let run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "done") return;
  const lease = await claimSellfoxRun(runId);
  if (!lease) return;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void fenceSellfoxRun(lease).catch(() => undefined).finally(() => { renewing = false; });
  }, 30_000);
  timer.unref();
  try {
    run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId } });
    if (!run) throw new SellfoxLeaseLostError();
    if (!(await canExecuteSellfoxSync(run))) throw new SellfoxSyncInputError("同步已停止：发起用户或工作区已失去有效权限。");
    if (!isSellfoxSyncResource(run.resource) && !isSellfoxEndpointResource(run.resource)) throw new SellfoxSyncInputError("请选择有效的赛狐同步资源。");
    if (sellfoxSyncDisabledReason(run.resource)) throw new SellfoxSyncUnavailableError(run.resource);
    let summary = asRecord(run.summary) ?? {};
    if (summary.datesFrozen !== true) {
      if (!isSellfoxSyncResource(run.resource)) throw new SellfoxSyncInputError("通用端点任务必须含已冻结日期窗口。");
      const dates = normalizeSellfoxDates(run.resource, summary, run.startedAt ?? new Date());
      summary = { ...summary, ...dates, datesFrozen: true, requestVersion: 2 };
    }
    if (run.resource !== "stores" && summary.storesFrozen !== true) {
      const requested = Array.isArray(summary.shopExternalIds) ? summary.shopExternalIds.filter((id): id is string => typeof id === "string") : [];
      const stores = await prisma.sellfoxStore.findMany({ where: {
        organizationId: run.organizationId, workspaceId: run.workspaceId, ...(requested.length ? { externalId: { in: requested } } : {}),
      }, select: { externalId: true }, orderBy: { externalId: "asc" } });
      if (!stores.length) {
        // 依赖未就绪（stores 尚未成功落库）：等待而非失败。正常释放租约，
        // 由 stores 成功后的唤醒钩子重新入队，不消耗重试次数、不写失败记录。
        await markRunWaitingDependency(lease, runId, "等待店铺主数据（stores）同步完成。");
        return;
      }
      if (requested.length && stores.length !== new Set(requested).size) throw new SellfoxSyncInputError("所选店铺不属于当前工作区。");
      summary = { ...summary, shopExternalIds: stores.map((store) => store.externalId), storesFrozen: true };
    }
    if ((run.resource === "inventory" || run.resource === "sales" || run.resource === "listings" || run.resource === "performance" || run.resource === "orders" || run.resource === "fba_shipments") && !summary.capturedAt) {
      const capturedAt = new Date();
      summary = { ...summary, capturedAt: capturedAt.toISOString(), ...(run.resource === "inventory" ? { reportDate: sellfoxDateAt(capturedAt) } : {}) };
    }
    if (run.resource !== "stores" && (!Array.isArray(summary.shopExternalIds) || !summary.shopExternalIds.length || summary.shopExternalIds.some((id) => typeof id !== "string" || !id.trim()))) {
      throw new SellfoxSyncInputError("同步任务缺少有效的已冻结店铺范围。");
    }
    await prisma.$transaction(async (tx) => {
      await fenceSellfoxRun(lease, tx);
      await tx.sellfoxSyncRun.update({ where: { id: runId }, data: { summary: summary as Prisma.InputJsonValue } });
    });
    const request = summary as { shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string; adTypes?: string[]; backfillFrom?: string; backfillTo?: string; scheduleId?: string };
    if (!isSellfoxSyncResource(run.resource) && !isSellfoxEndpointResource(run.resource)) throw new SellfoxSyncInputError("无效同步资源。");
    const input: SyncInput = {
      organizationId: run.organizationId, workspaceId: run.workspaceId, userId: run.userId, runId, resource: run.resource, lease,
      shopExternalIds: request.shopExternalIds, reportDate: request.reportDate, startDate: request.startDate,
      endDate: request.endDate, backfillFrom: request.backfillFrom, backfillTo: request.backfillTo, progress: request.progress, capturedAt: request.capturedAt,
    };
    const executingRun = run;
    await withSellfoxCredentialScope({ organizationId: run.organizationId, workspaceId: run.workspaceId }, async () => {
    let result: unknown;
    if (input.resource === "stores") result = { count: await syncStores(input) };
    else if (input.resource === "performance") {
      const dates = sellfoxReportDates(request.startDate ?? request.reportDate!, request.endDate ?? request.reportDate!);
      let count = 0; let storeCount = 0;
      for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
        const date = dates[dateIndex];
        for (const onlySettle of [false, true]) {
          const progressKey = onlySettle ? "performanceSettled" : "performance";
          const latest = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
          const progress = asRecord(asRecord(latest?.summary)?.progress);
          const states = asRecord(progress?.[progressKey]) ?? {};
          const resultForDate = await syncSellfoxProductDailySnapshots({
            organizationId: executingRun.organizationId, workspaceId: executingRun.workspaceId, storeExternalIds: request.shopExternalIds, reportDate: date, onlySettle, capturedAt: request.capturedAt,
            checkpoint: states[date] as PerformanceCheckpoint | undefined,
            cursor: !onlySettle && !states[date] && dateIndex === Number(request.progress?.dateIndex ?? 0) ? asRecord(request.progress?.cursor) as { storeIndex?: number; pageNo?: number } | null ?? undefined : undefined,
            onProgress: async (update, tx) => {
              const db = tx ?? prisma;
              const current = await db.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
              const currentProgress = asRecord(asRecord(current?.summary)?.progress) ?? {};
              const checkpoints = { ...asRecord(currentProgress[progressKey]), [date]: update.checkpoint };
              const partitions = { ...currentProgress, [progressKey]: checkpoints };
              const total = ["performance", "performanceSettled"].reduce((sum, key) => sum + Object.values(asRecord(partitions[key]) ?? {}).reduce<number>((n, state) => n + Object.values((state as PerformanceCheckpoint).stores).reduce((value, store) => value + store.synced, 0), 0), 0);
              await saveProgress(input, { ...currentProgress, dateIndex, reportDate: date, [progressKey]: checkpoints, count: total }, db);
            },
          });
          count += resultForDate.synced; storeCount = Math.max(storeCount, resultForDate.storeCount);
        }
      }
      result = { startDate: dates[0], endDate: dates[dates.length - 1], storeCount, synced: count, onlySettleModes: [false, true] };
    }
    else if (input.resource === "inventory" || input.resource === "sales") result = await syncSnapshots(input);
    else if (input.resource === "listings") result = await syncSellfoxListings({ ...input, shopExternalIds: input.shopExternalIds!, capturedAt: input.capturedAt!, checkpoint: input.progress?.listings as ListingCheckpoint | undefined, onProgress: async (listings, tx) => saveProgress(input, { listings, count: Object.values(listings).reduce((n, item) => n + item.count, 0) }, tx) });
    else if (input.resource === "orders") result = await syncSellfoxOrders({ ...input, shopExternalIds: input.shopExternalIds!, startDate: input.startDate!, endDate: input.endDate!, capturedAt: input.capturedAt!, checkpoint: input.progress?.orders as OrderCheckpoint | undefined, onProgress: async (orders, tx) => saveProgress(input, { orders, count: Object.values(orders).reduce((n, item) => n + item.count, 0) }, tx) });
    else if (input.resource === "fba_shipments") result = await syncSellfoxFbaShipments({ ...input, shopExternalIds: input.shopExternalIds!, startDate: input.startDate, endDate: input.endDate, capturedAt: input.capturedAt!, checkpoint: input.progress?.fba_shipments as FbaShipmentCheckpoint | undefined, onProgress: async (fbaShipments, tx) => saveProgress(input, { fba_shipments: fbaShipments, count: Object.values(fbaShipments).reduce((n, item) => n + item.count, 0) }, tx) });
    else if (["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"].includes(input.resource)) result = await syncSellfoxAdsReports({ ...input, reportTypeCode: input.resource === "ads_campaign" ? "adCampaignReport" : input.resource === "ads_ad_group" ? "adGroupReport" : input.resource === "ads_placement" ? "adSpaceReport" : input.resource === "ads_targeting" ? "adTargeringReport" : input.resource === "ads_search_term" ? "adSearchTermReport" : "adProductReport", startDate: input.startDate!, endDate: input.endDate!, shopExternalIds: input.shopExternalIds!, adTypes: sellfoxAdsAllowedAdTypes(input.resource, request.adTypes), onProgress: async (progress, tx) => saveProgress(input, progress, tx) });
    else if (input.resource === "hourly") result = await syncHourly(input);
    else if (isSellfoxEndpointResource(input.resource)) {
      const code = sellfoxEndpointCode(input.resource)!;
      const config = await prisma.sellfoxApiEndpoint.findUnique({ where: { organizationId_workspaceId_code: { organizationId: input.organizationId, workspaceId: input.workspaceId, code } } });
      if (!config || !config.enabled) throw new SellfoxSyncInputError(`端点 ${code} 不存在或已停用。`);
      result = await syncSellfoxGenericEndpoint({
        runId: input.runId, organizationId: input.organizationId, workspaceId: input.workspaceId, lease: input.lease,
        endpoint: endpointConfig(config), shopExternalIds: input.shopExternalIds ?? [],
        startDate: request.startDate, endDate: request.endDate, progress: request.progress,
        onProgress: async (progress, tx) => saveProgress(input, progress, tx),
      });
    }
    else throw new SellfoxSyncInputError("此赛狐数据域暂未接入 Open API。");
    // Re-read after page commits; never overwrite current progress with the initial summary.
    await prisma.$transaction(async (tx) => {
      await fenceSellfoxRun(lease, tx);
      const current = await tx.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
      if (input.resource === "sales" && request.scheduleId && request.backfillFrom && request.backfillTo) {
        const next = new Date(Date.parse(`${request.backfillTo}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
        await tx.sellfoxSyncSchedule.updateMany({ where: { id: request.scheduleId, organizationId: input.organizationId, workspaceId: input.workspaceId, backfillNextDate: request.backfillFrom }, data: { backfillNextDate: next } });
      }
      const reconciliation = buildSellfoxReconciliation(result, asRecord(current?.summary)?.progress);
      await finishSellfoxRun(lease, { status: "done", summary: { ...asRecord(current?.summary), result, reconciliation } as Prisma.InputJsonValue }, tx);
    });
    // 保留 hub overview 缓存失效（另一套缓存），并新增按域失效读缓存；失效失败只记录，不把已完成的同步改判为失败。
    invalidateHubOverview(input.organizationId, input.workspaceId);
    try {
      await invalidateSellfoxSyncResource(input.organizationId, input.workspaceId, input.resource);
    } catch (cacheError) {
      console.error(JSON.stringify({ scope: "sellfox.sync.cache-invalidate", resource: input.resource, runId, message: cacheError instanceof Error ? cacheError.message : "unknown" }));
    }
    // P1 画像窄表 + P2 预聚合：成功后的派生投影，全部由开关控制且失败只记日志，
    // 永不把已完成的同步改判为失败。投影口径来自源表/视图，不产生新的业务事实。
    try {
      await runPostSyncProjections({
        organizationId: input.organizationId, workspaceId: input.workspaceId,
        resource: input.resource, shopExternalIds: request.shopExternalIds ?? [],
        reportDate: request.reportDate, startDate: request.startDate, endDate: request.endDate,
        runId,
      });
    } catch (projectionError) {
      console.error(JSON.stringify({ scope: "sellfox.sync.projections", resource: input.resource, runId, message: projectionError instanceof Error ? projectionError.message : "unknown" }));
    }
    // 分片与覆盖度是记账，不是业务数据：失败只打日志，不把成功的同步改判为失败。
    try {
      const shards = buildRunShards(input.resource, { reportDate: request.reportDate, startDate: request.startDate, endDate: request.endDate }, result, request.progress);
      await recordSellfoxShards({ organizationId: input.organizationId, workspaceId: input.workspaceId, resource: input.resource, runId }, shards);
      if (input.resource !== "stores") {
        await refreshSellfoxCoverage({ organizationId: input.organizationId, workspaceId: input.workspaceId, resource: input.resource, runId, status: "done" });
      }
    } catch (bookkeepingError) {
      console.error(JSON.stringify({ scope: "sellfox.sync-shards", resource: input.resource, runId, message: bookkeepingError instanceof Error ? bookkeepingError.message : "unknown" }));
    }
    // stores 首次成功落库后，唤醒本工作区因缺店铺而等待的下游任务，并按原窗口重排历史失败任务。
    // 整段是成功后的附带编排：任何异常都只记录，不得把已完成的 stores 同步改判为失败。
    if (input.resource === "stores") {
      try {
        if (await sellfoxStoresReady({ organizationId: input.organizationId, workspaceId: input.workspaceId })) {
          await wakeWaitingDependents({ organizationId: input.organizationId, workspaceId: input.workspaceId });
        }
      } catch (wakeError) { console.error(JSON.stringify({ scope: "sellfox.sync.wake", runId, message: wakeError instanceof Error ? wakeError.message : "unknown" })); }
    }
    });
  } catch (error) {
    if (error instanceof SellfoxLeaseLostError) throw error;
    const message = error instanceof SellfoxSyncUnavailableError || error instanceof SellfoxStoreSyncError ? error.message : sellfoxStoreFailure(error).error;
    await finishSellfoxRun(lease, { status: "failed", error: message });
    invalidateHubOverview(run!.organizationId, run!.workspaceId);
    throw error;
  } finally { clearInterval(timer); }
}
