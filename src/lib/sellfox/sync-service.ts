import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots, type PerformanceCheckpoint } from "@/lib/sellfox/product-performance";
import { sellfoxPost } from "@/lib/sellfox/client";
import { isSellfoxSyncResource, normalizeSellfoxDates, sellfoxReportDates, SellfoxSyncInputError, nextSellfoxPage, sellfoxSyncResources, sellfoxSyncDisabledReason, SellfoxSyncUnavailableError, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { sellfoxInventoryRequest, sellfoxSalesRequest } from "@/lib/sellfox/sync-requests";

export const sellfoxResources = sellfoxSyncResources;
export type SyncResource = SellfoxSyncResource;
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

type SyncInput = { organizationId: string; workspaceId: string; runId: string; userId: string; resource: SyncResource; shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string };

async function saveProgress(input: SyncInput, summary: Record<string, unknown>, db: Pick<Prisma.TransactionClient, "sellfoxSyncRun"> = prisma) {
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
        const data = { name: field(row, "shopName", "name", "storeName"), marketplace: field(row, "marketplace", "marketplaceName", "marketplaceId"), country: field(row, "country", "countryName"), status: field(row, "status", "shopStatus"), payload: row as Prisma.InputJsonValue, lastSyncedAt: now, updatedAt: now };
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

async function syncInventory(input: SyncInput) {
  const stores = await storesFor(input); let count = 0; let failures = 0; let pageCursor: Record<string, unknown> | null = null;
  const syncedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const reportDate = input.reportDate ?? syncedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const cursor = asRecord(input.progress?.cursor);
  const startStoreIndex = Math.max(0, Number(cursor?.storeIndex) || 0);
  const startPageNo = Math.max(1, Number(cursor?.pageNo) || 1);
  let firstFailedCursor: Record<string, unknown> | null = null;
  for (let storeIndex = startStoreIndex; storeIndex < stores.length; storeIndex += 1) {
    const store = stores[storeIndex];
    try {
      for (let pageNo = storeIndex === startStoreIndex ? startPageNo : 1; pageNo <= 10_000; pageNo += 1) {
        const payload = await sellfoxPost<unknown>("/api/inventoryManage/fba/pageList.json", sellfoxInventoryRequest(store.externalId, pageNo));
        const rows = rowsFrom(payload);
        if (!Array.isArray(payload) && rows.length === 0) throw new Error("库存接口返回结构无法识别。");
        for (const row of rows) {
          const sku = field(row, "sku", "sellerSku"); const msku = field(row, "msku"); const asin = field(row, "asin"); const fnsku = field(row, "fnsku", "fnSku");
          const sourceKey = field(row, "inventoryId", "id") || [asin, msku, sku, fnsku, field(row, "condition", "inventoryCondition"), field(row, "fulfillmentChannel", "warehouseType")].filter(Boolean).join("|");
          if (!sourceKey) continue;
          await prisma.sellfoxFbaInventorySnapshot.upsert({
            where: { storeId_capturedAt_sourceKey: { storeId: store.id, capturedAt: syncedAt, sourceKey } },
            create: { id: `sellfox-inventory-${store.id}-${syncedAt.getTime()}-${sourceKey}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate, capturedAt: syncedAt, sourceKey, sku, msku, asin, fnsku, quantity: num(row, "quantity", "availableQuantity", "afnFulfillableQuantity", "totalQuantity"), payload: row as Prisma.InputJsonValue, syncedAt, updatedAt: syncedAt },
            update: { sku, msku, asin, fnsku, quantity: num(row, "quantity", "availableQuantity", "afnFulfillableQuantity", "totalQuantity"), payload: row as Prisma.InputJsonValue, syncedAt, updatedAt: syncedAt },
          }); count += 1;
        }
        const nextPage = nextSellfoxPage(rows.length, pageNo, pageCount(payload));
        const hasMore = nextPage !== null;
        pageCursor = hasMore ? { shopExternalId: store.externalId, storeIndex, pageNo: nextPage } : { shopExternalId: stores[storeIndex + 1]?.externalId ?? "", storeIndex: storeIndex + 1, pageNo: 1 };
        await saveProgress(input, { count, storeExternalId: store.externalId, pageNo, cursor: pageCursor, failures });
        if (!hasMore) break;
      }
    } catch { failures += 1; firstFailedCursor ??= pageCursor ?? { shopExternalId: store.externalId, storeIndex, pageNo: storeIndex === startStoreIndex ? startPageNo : 1 }; await saveProgress(input, { count, storeExternalId: store.externalId, cursor: firstFailedCursor, failures }); }
  }
  if (failures) { await saveProgress(input, { count, cursor: firstFailedCursor, failures }); throw new Error(`${failures} 个店铺库存同步失败，已记录已完成数据和运行进度。`); }
  return { count, storeCount: stores.length, reportDate };
}

async function syncSales(input: SyncInput) {
  const stores = await storesFor(input); let count = 0; let failures = 0; const reportDate = input.reportDate ?? defaultSellfoxReportDate(); const startDate = input.startDate ?? input.reportDate ?? defaultSellfoxReportDate(); const endDate = input.endDate ?? input.startDate ?? input.reportDate ?? defaultSellfoxReportDate(); const syncedAt = new Date();
  const cursor = asRecord(input.progress?.cursor);
  const startStoreIndex = Math.max(0, Number(cursor?.storeIndex) || 0);
  const startPageNo = Math.max(1, Number(cursor?.pageNo) || 1);
  let firstFailedCursor: Record<string, unknown> | null = null;
  for (let storeIndex = startStoreIndex; storeIndex < stores.length; storeIndex += 1) {
    const store = stores[storeIndex];
    try {
      for (let pageNo = storeIndex === startStoreIndex ? startPageNo : 1; pageNo <= 10_000; pageNo += 1) {
        // This adapter stays disabled until the daily response and metric join are verified.
        const payload = await sellfoxPost<unknown>("/api/productSale/page.json", sellfoxSalesRequest(store.externalId, startDate, pageNo, "productNum"));
        const rows = rowsFrom(payload);
        if (!Array.isArray(payload) && rows.length === 0) throw new Error("销量接口返回结构无法识别。");
        for (const row of rows) {
          const sku = field(row, "sku", "sellerSku"); const msku = field(row, "msku"); const asin = field(row, "asin");
          const rowDate = field(row, "reportDate", "saleDate", "date") || (startDate === endDate ? startDate : "");
          if (!rowDate) throw new Error("销量日期区间响应缺少逐日日期字段，已停止写入以避免将多日数据合并。");
          const sourceKey = field(row, "sourceKey", "id") || [asin, msku, sku].filter(Boolean).join("|");
          if (!sourceKey) continue;
          await prisma.sellfoxSalesDailySnapshot.upsert({
            where: { storeId_reportDate_sourceKey: { storeId: store.id, reportDate: rowDate, sourceKey } },
            create: { id: `sellfox-sales-${store.id}-${rowDate}-${sourceKey}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate: rowDate, sourceKey, sku, msku, asin, quantity: num(row, "quantity", "saleQuantity", "saleNum", "salesVolume"), revenue: num(row, "revenue", "saleRevenue", "saleAmount", "salesAmount"), currency: field(row, "currency", "currencyCode"), payload: row as Prisma.InputJsonValue, syncedAt, updatedAt: syncedAt },
            update: { sku, msku, asin, quantity: num(row, "quantity", "saleQuantity", "saleNum", "salesVolume"), revenue: num(row, "revenue", "saleRevenue", "saleAmount", "salesAmount"), currency: field(row, "currency", "currencyCode"), payload: row as Prisma.InputJsonValue, syncedAt, updatedAt: syncedAt },
          }); count += 1;
        }
        const nextPage = nextSellfoxPage(rows.length, pageNo, pageCount(payload));
        const hasMore = nextPage !== null;
        const nextCursor = hasMore ? { shopExternalId: store.externalId, storeIndex, pageNo: nextPage } : { shopExternalId: stores[storeIndex + 1]?.externalId ?? "", storeIndex: storeIndex + 1, pageNo: 1 };
        await saveProgress(input, { count, storeExternalId: store.externalId, pageNo, cursor: nextCursor, failures });
        if (!hasMore) break;
      }
    } catch { failures += 1; firstFailedCursor ??= { shopExternalId: store.externalId, storeIndex, pageNo: storeIndex === startStoreIndex ? startPageNo : 1 }; await saveProgress(input, { count, storeExternalId: store.externalId, cursor: firstFailedCursor, failures }); }
  }
  if (failures) { await saveProgress(input, { count, cursor: firstFailedCursor, failures }); throw new Error(`${failures} 个店铺销量同步失败，已记录已完成数据和运行进度。`); }
  return { count, storeCount: stores.length, reportDate };
}

async function syncHourly(input: SyncInput) {
  const stores = await storesFor(input); let count = 0; const reportDate = input.reportDate ?? defaultSellfoxReportDate();
  for (const store of stores) {
    const campaigns = rowsFrom(await sellfoxPost<unknown>("/api/cpc/manageData/spCampaign.json", { shopId: store.externalId, pageSize: 100 }));
    for (const campaign of campaigns.slice(0, 5)) {
      const campaignId = field(campaign, "campaignId", "id"); if (!campaignId) continue;
      const metrics = rowsFrom(await sellfoxPost<unknown>("/api/cpc/hourData/spCampaign.json", { aggregationType: "campaign", shopId: store.externalId, date: reportDate, campaignId }));
      for (const metric of metrics) {
        const rawHour = num(metric, "hour", "reportHour", "timeHour") ?? 0;
        const hour = Math.min(Math.max(Math.floor(rawHour), 0), 23); const now = new Date();
        await prisma.sellfoxHourlyMetric.upsert({
          where: { storeId_reportDate_hour_adType_entityType_entityId: { storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId } },
          create: { id: `sellfox-hourly-${store.id}-${reportDate}-${hour}-sp-campaign-${campaignId}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId, entityName: field(campaign, "campaignName", "name"), impressions: Math.floor(num(metric, "impressions") ?? 0), clicks: Math.floor(num(metric, "clicks") ?? 0), cost: num(metric, "cost", "costs", "spend") ?? 0, sales: num(metric, "sales", "salesAmount") ?? 0, orders: Math.floor(num(metric, "orders", "purchases") ?? 0), payload: metric as Prisma.InputJsonValue },
          update: { impressions: Math.floor(num(metric, "impressions") ?? 0), clicks: Math.floor(num(metric, "clicks") ?? 0), cost: num(metric, "cost", "costs", "spend") ?? 0, sales: num(metric, "sales", "salesAmount") ?? 0, orders: Math.floor(num(metric, "orders", "purchases") ?? 0), payload: metric as Prisma.InputJsonValue, syncedAt: now },
        }); count += 1;
      }
    }
  }
  return { count, storeCount: stores.length, reportDate, depth: "first five SP campaigns per store" };
}

export async function processSellfoxSyncRun(runId: string) {
  const run = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "done") return;
  await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "running", error: null, finishedAt: null } });
  try {
    if (!isSellfoxSyncResource(run.resource)) throw new SellfoxSyncInputError("请选择有效的赛狐同步资源。");
    if (sellfoxSyncDisabledReason(run.resource)) throw new SellfoxSyncUnavailableError(run.resource);
    let summary = asRecord(run.summary) ?? {};
    if (summary.datesFrozen !== true) {
      const dates = normalizeSellfoxDates(run.resource, summary, run.startedAt ?? new Date());
      summary = { ...summary, ...dates, datesFrozen: true, requestVersion: 2 };
    }
    if (run.resource !== "stores" && summary.storesFrozen !== true) {
      const requested = Array.isArray(summary.shopExternalIds) ? summary.shopExternalIds.filter((id): id is string => typeof id === "string") : [];
      const stores = await prisma.sellfoxStore.findMany({ where: {
        organizationId: run.organizationId, workspaceId: run.workspaceId, ...(requested.length ? { externalId: { in: requested } } : {}),
      }, select: { externalId: true }, orderBy: { externalId: "asc" } });
      if (!stores.length) throw new SellfoxSyncInputError("当前工作区没有可同步店铺，请先同步店铺。");
      if (requested.length && stores.length !== new Set(requested).size) throw new SellfoxSyncInputError("所选店铺不属于当前工作区。");
      summary = { ...summary, shopExternalIds: stores.map((store) => store.externalId), storesFrozen: true };
    }
    if (run.resource !== "stores" && (!Array.isArray(summary.shopExternalIds) || !summary.shopExternalIds.length || summary.shopExternalIds.some((id) => typeof id !== "string" || !id.trim()))) {
      throw new SellfoxSyncInputError("同步任务缺少有效的已冻结店铺范围。");
    }
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { summary: summary as Prisma.InputJsonValue } });
    const request = summary as { shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string };
    const input: SyncInput = {
      organizationId: run.organizationId, workspaceId: run.workspaceId, userId: run.userId, runId, resource: run.resource,
      shopExternalIds: request.shopExternalIds, reportDate: request.reportDate, startDate: request.startDate,
      endDate: request.endDate, progress: request.progress, capturedAt: request.capturedAt,
    };
    let result: unknown;
    if (input.resource === "stores") result = { count: await syncStores(input) };
    else if (input.resource === "performance") {
      const dates = sellfoxReportDates(request.startDate ?? request.reportDate!, request.endDate ?? request.reportDate!);
      let count = 0; let storeCount = 0;
      for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
        const date = dates[dateIndex];
        const latest = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
        const progress = asRecord(asRecord(latest?.summary)?.progress);
        const states = asRecord(progress?.performance) ?? {};
        const resultForDate = await syncSellfoxProductDailySnapshots({
          organizationId: run.organizationId, workspaceId: run.workspaceId, storeExternalIds: request.shopExternalIds, reportDate: date,
          checkpoint: states[date] as PerformanceCheckpoint | undefined,
          cursor: !states[date] && dateIndex === Number(request.progress?.dateIndex ?? 0) ? asRecord(request.progress?.cursor) as { storeIndex?: number; pageNo?: number } | null ?? undefined : undefined,
          onProgress: async (update, tx) => {
            const db = tx ?? prisma;
            const current = await db.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
            const currentProgress = asRecord(asRecord(current?.summary)?.progress) ?? {};
            const checkpoints = { ...asRecord(currentProgress.performance), [date]: update.checkpoint };
            const total = Object.values(checkpoints).reduce<number>((sum, state) => sum + Object.values((state as PerformanceCheckpoint).stores).reduce((value, store) => value + store.synced, 0), 0);
            await saveProgress(input, { ...currentProgress, dateIndex, reportDate: date, performance: checkpoints, count: total }, db);
          },
        });
        count += resultForDate.synced; storeCount = Math.max(storeCount, resultForDate.storeCount);
      }
      result = { startDate: dates[0], endDate: dates[dates.length - 1], storeCount, synced: count };
    }
    else if (input.resource === "inventory") result = await syncInventory(input);
    else if (input.resource === "sales") result = await syncSales(input);
    else if (input.resource === "hourly") result = await syncHourly(input);
    else throw new SellfoxSyncInputError("此赛狐数据域暂未接入 Open API。");
    // Re-read after page commits; never overwrite current progress with the initial summary.
    const current = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "done", summary: { ...asRecord(current?.summary), result } as Prisma.InputJsonValue, finishedAt: new Date() } });
  } catch (error) {
    const message = error instanceof SellfoxSyncUnavailableError || error instanceof SellfoxStoreSyncError ? error.message : sellfoxStoreFailure(error).error;
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "failed", error: message, finishedAt: new Date() } });
    throw error;
  }
}
