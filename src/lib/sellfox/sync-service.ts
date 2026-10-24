import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";
import { sellfoxPost } from "@/lib/sellfox/client";
import { nextSellfoxPage, sellfoxSyncResources, sellfoxSyncDisabledReason, SellfoxSyncUnavailableError, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { sellfoxInventoryRequest, sellfoxSalesRequest } from "@/lib/sellfox/sync-requests";

export const sellfoxResources = sellfoxSyncResources;
export type SyncResource = SellfoxSyncResource;
type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}
function rowsFrom(value: unknown): RecordLike[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is RecordLike => Boolean(row));
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["rows", "records", "list", "itemList", "data", "result"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested.map(asRecord).filter((row): row is RecordLike => Boolean(row));
    if (asRecord(nested)) {
      const rows = rowsFrom(nested);
      if (rows.length) return rows;
    }
  }
  return [];
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
function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`), endTime = Date.parse(`${end}T00:00:00Z`); time <= endTime && dates.length < 90; time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

type SyncInput = { organizationId: string; workspaceId: string; runId: string; userId: string; resource: SyncResource; shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string };

async function saveProgress(input: SyncInput, summary: Record<string, unknown>) {
  const current = await prisma.sellfoxSyncRun.findUnique({ where: { id: input.runId }, select: { summary: true } });
  const request = (current?.summary ?? {}) as Record<string, unknown>;
  await prisma.sellfoxSyncRun.update({ where: { id: input.runId }, data: { summary: { ...request, progress: summary } as Prisma.InputJsonValue } });
}

async function storesFor(input: SyncInput) {
  return prisma.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(input.shopExternalIds?.length ? { externalId: { in: input.shopExternalIds } } : {}) },
    orderBy: { externalId: "asc" },
  });
}

async function syncStores(input: SyncInput) {
  let count = 0;
  const resumePage = Math.max(1, Number(input.progress?.pageNo) || 1);
  for (let pageNo = resumePage; pageNo <= 1_000; pageNo += 1) {
    const payload = await sellfoxPost<unknown>("/api/shop/pageList.json", { pageNo, pageSize: 100 });
    const rows = rowsFrom(payload);
    for (const row of rows) {
      const externalId = field(row, "shopId", "id", "storeId");
      if (!externalId) continue;
      const now = new Date();
      await prisma.sellfoxStore.upsert({
        where: { organizationId_workspaceId_externalId: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId } },
        create: { id: `sellfox-store-${input.organizationId}-${input.workspaceId}-${externalId}`, organizationId: input.organizationId, workspaceId: input.workspaceId, externalId, name: field(row, "shopName", "name", "storeName"), marketplace: field(row, "marketplace", "marketplaceName", "marketplaceId"), country: field(row, "country", "countryName"), status: field(row, "status", "shopStatus"), payload: row as Prisma.InputJsonValue, updatedAt: now },
        update: { name: field(row, "shopName", "name", "storeName"), marketplace: field(row, "marketplace", "marketplaceName", "marketplaceId"), country: field(row, "country", "countryName"), status: field(row, "status", "shopStatus"), payload: row as Prisma.InputJsonValue, lastSyncedAt: now, updatedAt: now },
      });
      count += 1;
    }
    await saveProgress(input, { count, pageNo, cursor: { pageNo: pageNo + 1 } });
    if (nextSellfoxPage(rows.length, pageNo, pageCount(payload)) === null) break;
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
  await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "running", error: null } });
  let summary = (run.summary ?? {}) as Record<string, unknown>;
  if (run.resource === "inventory" && typeof summary.capturedAt !== "string") {
    summary = { ...summary, capturedAt: new Date().toISOString() };
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { summary: summary as Prisma.InputJsonValue } });
  }
  const request = summary as { shopExternalIds?: string[]; reportDate?: string; startDate?: string; endDate?: string; progress?: Record<string, unknown>; capturedAt?: string };
  const input: SyncInput = { organizationId: run.organizationId, workspaceId: run.workspaceId, userId: run.userId, runId, resource: run.resource as SyncResource, ...request };
  try {
    if (sellfoxSyncDisabledReason(input.resource)) throw new SellfoxSyncUnavailableError(input.resource);
    let result: unknown;
    if (input.resource === "stores") result = { count: await syncStores(input) };
    else if (input.resource === "performance") {
      const startDate = request.startDate ?? request.reportDate ?? defaultSellfoxReportDate();
      const endDate = request.endDate ?? request.startDate ?? request.reportDate ?? defaultSellfoxReportDate();
      const dates = datesBetween(startDate, endDate);
      const dateIndexStart = Math.max(0, Number(request.progress?.dateIndex) || 0);
      let count = 0; let storeCount = 0;
      for (let dateIndex = dateIndexStart; dateIndex < dates.length; dateIndex += 1) {
        const date = dates[dateIndex];
        const resultForDate = await syncSellfoxProductDailySnapshots({
          organizationId: run.organizationId, workspaceId: run.workspaceId, storeExternalIds: request.shopExternalIds, reportDate: date,
          cursor: dateIndex === dateIndexStart ? asRecord(request.progress?.cursor) as { storeIndex?: number; pageNo?: number } | null ?? undefined : undefined,
          onProgress: async (progress) => saveProgress(input, { dateIndex, reportDate: date, cursor: progress.cursor, count: count + progress.synced, ...(progress.failedStores ? { failedStores: progress.failedStores } : {}) }),
        });
        count += resultForDate.synced; storeCount = Math.max(storeCount, resultForDate.storeCount);
        await saveProgress(input, { dateIndex: dateIndex + 1, reportDate: date, cursor: { storeIndex: 0, pageNo: 1 }, count });
      }
      result = { startDate: dates[0], endDate: dates[dates.length - 1], storeCount, synced: count };
    }
    else if (input.resource === "inventory") result = await syncInventory(input);
    else if (input.resource === "sales") result = await syncSales(input);
    else if (input.resource === "hourly") result = await syncHourly(input);
    else throw new Error("此赛狐数据域暂未接入 Open API。");
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "done", summary: { ...summary, result } as Prisma.InputJsonValue, finishedAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[\r\n]/g, " ").slice(0, 300) : "赛狐同步失败。";
    await prisma.sellfoxSyncRun.update({ where: { id: runId }, data: { status: "failed", error: message, finishedAt: new Date() } });
    throw error;
  }
}
