import { canExecuteSellfoxSync } from "@/lib/sellfox/sync-authorization";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots, type PerformanceCheckpoint } from "@/lib/sellfox/product-performance";
import { sellfoxPost } from "@/lib/sellfox/client";
import { isSellfoxSyncResource, normalizeSellfoxDates, sellfoxReportDates, sellfoxDateAt, SellfoxSyncInputError, nextSellfoxPage, sellfoxSyncResources, sellfoxSyncDisabledReason, SellfoxSyncUnavailableError, type SellfoxSyncResource } from "@/lib/sellfox/sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { syncSellfoxSnapshotStores, type SnapshotCheckpoint } from "@/lib/sellfox/snapshot-sync";

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

async function syncSnapshots(input: SyncInput) {
  if (input.resource !== "inventory" && input.resource !== "sales") throw new SellfoxSyncInputError("快照资源无效。");
  const dates = input.resource === "inventory" ? [input.reportDate!] : sellfoxReportDates(input.startDate!, input.endDate!);
  let writes = 0; let storeCount = 0;
  for (const date of dates) {
    const latest = await prisma.sellfoxSyncRun.findUnique({ where: { id: input.runId }, select: { summary: true } });
    const states = asRecord(asRecord(asRecord(latest?.summary)?.progress)?.snapshots) ?? {};
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
  }
  return { startDate: dates[0], endDate: dates[dates.length - 1], storeCount, writes };
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
    if (!(await canExecuteSellfoxSync(run))) throw new SellfoxSyncInputError("同步已停止：发起用户或工作区已失去有效权限。");
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
    if ((run.resource === "inventory" || run.resource === "sales") && !summary.capturedAt) {
      const capturedAt = new Date();
      summary = { ...summary, capturedAt: capturedAt.toISOString(), ...(run.resource === "inventory" ? { reportDate: sellfoxDateAt(capturedAt) } : {}) };
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
    else if (input.resource === "inventory" || input.resource === "sales") result = await syncSnapshots(input);
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
