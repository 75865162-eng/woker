import { sellfoxNumber } from "./narrow-contracts";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "@/lib/sellfox/client";
import { nextSellfoxPage, sellfoxDateAt, SellfoxSyncInputError } from "@/lib/sellfox/sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";

type RecordLike = Record<string, unknown>;
export type PerformanceStoreProgress = { pageNo: number; done: boolean; synced: number; error?: string; retryable?: boolean };
export type PerformanceCheckpoint = { stores: Record<string, PerformanceStoreProgress> };
type PerformanceProgress = { reportDate: string; synced: number; checkpoint: PerformanceCheckpoint };
type Dependencies = { db: Pick<PrismaClient, "sellfoxStore" | "$transaction">; post: typeof sellfoxPost };

function text(row: RecordLike, key: string) {
  const value = row[key];
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String(item[key === "asinList" ? "asin" : "sku"] ?? "") : "").filter(Boolean).join(",");
  return value === undefined || value === null ? "" : String(value).trim();
}
function number(row: RecordLike, key: string) {
  return sellfoxNumber(row, key, ["saleNum", "saleNumFba", "saleNumFbm"].includes(key));
}
function pageFrom(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SellfoxSyncInputError("产品表现响应结构无法识别。");
  const record = payload as RecordLike;
  if (!Array.isArray(record.rows) || record.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new SellfoxSyncInputError("产品表现响应缺少有效 rows 列表。");
  }
  const totalPage = record.totalPage === undefined || record.totalPage === null ? null : Number(record.totalPage);
  const totalSize = record.totalSize === undefined || record.totalSize === null ? null : Number(record.totalSize);
  if ((totalPage !== null && (!Number.isInteger(totalPage) || totalPage < 0)) || (totalSize !== null && (!Number.isInteger(totalSize) || totalSize < 0))) {
    throw new SellfoxSyncInputError("产品表现分页信息无效。");
  }
  if ((totalPage === 0 || totalSize === 0) && record.rows.length) throw new SellfoxSyncInputError("产品表现分页总数与记录不一致。");
  return { rows: record.rows as RecordLike[], totalPages: totalPage ?? (totalSize === null ? null : Math.ceil(totalSize / 100)) };
}

export function defaultSellfoxReportDate(now = new Date()) { return sellfoxDateAt(now, -1); }

export async function syncSellfoxProductDailySnapshots(input: {
  organizationId: string;
  workspaceId: string;
  reportDate?: string;
  storeExternalId?: string;
  storeExternalIds?: string[];
  cursor?: { storeIndex?: number; pageNo?: number };
  checkpoint?: PerformanceCheckpoint;
  onProgress?: (progress: PerformanceProgress, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies: Dependencies = { db: prisma, post: sellfoxPost }) {
  const reportDate = input.reportDate ?? defaultSellfoxReportDate();
  const storeExternalIds = input.storeExternalIds?.length ? input.storeExternalIds : input.storeExternalId ? [input.storeExternalId] : undefined;
  const stores = await dependencies.db.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(storeExternalIds ? { externalId: { in: storeExternalIds } } : {}) },
    orderBy: { externalId: "asc" },
  });
  if (!stores.length) throw new SellfoxSyncInputError("当前工作区没有可同步店铺，请先同步店铺。");
  if (storeExternalIds && stores.length !== new Set(storeExternalIds).size) throw new SellfoxSyncInputError("任务中的店铺已不属于当前工作区，已停止同步。");
  let checkpoint: PerformanceCheckpoint = { stores: { ...input.checkpoint?.stores } };
  // Read legacy numeric cursors once; all new checkpoints use stable external IDs.
  if (!input.checkpoint && input.cursor) {
    stores.forEach((store, index) => {
      if (index <= (input.cursor?.storeIndex ?? 0)) checkpoint.stores[store.externalId] = {
        pageNo: index === input.cursor?.storeIndex ? Math.max(1, input.cursor.pageNo ?? 1) : 1,
        done: index < (input.cursor?.storeIndex ?? 0), synced: 0,
      };
    });
  }
  const syncedCount = (state: PerformanceCheckpoint) => Object.values(state.stores).reduce((sum, store) => sum + store.synced, 0);
  const failedStores: string[] = [];
  for (const store of stores) {
    const previous = checkpoint.stores[store.externalId];
    let pageNo = previous?.pageNo ?? 1;
    try {
      if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10_000 || (previous && (!Number.isInteger(previous.synced) || previous.synced < 0))) throw new SellfoxSyncInputError("产品表现同步断点无效。");
      if (previous?.done) continue;
      while (pageNo <= 10_000) {
        const payload = await dependencies.post<unknown>("/api/sale/profit/product/pageList.json", {
          pageNo, pageSize: 100, shopIdList: [store.externalId], startDate: reportDate, endDate: reportDate, type: "msku", currency: "",
        });
        const { rows, totalPages } = pageFrom(payload);
        // Validate pagination and identities before committing any part of this page.
        const nextPage = nextSellfoxPage(rows.length, pageNo, totalPages);
        const identities = rows.map((row) => text(row, "mskuList") || text(row, "skuList") || text(row, "asinList"));
        if (identities.some((key) => !key) || new Set(identities).size !== identities.length) throw new SellfoxSyncInputError("产品表现响应缺少唯一商品身份。");
        const nextCheckpoint: PerformanceCheckpoint = { stores: { ...checkpoint.stores, [store.externalId]: {
          pageNo: nextPage ?? pageNo, done: nextPage === null, synced: (checkpoint.stores[store.externalId]?.synced ?? 0) + rows.length,
        } } };
        await dependencies.db.$transaction(async (tx) => {
          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index]; const sourceKey = identities[index]; const now = new Date();
            const data = {
              sku: text(row, "skuList"), msku: text(row, "mskuList"), asin: text(row, "asinList"), parentAsin: text(row, "parentAsinList"),
              orderNum: sellfoxNumber(row, "orderNum", true), netRevenue: sellfoxNumber(row, "salesPriceNet"), title: text(row, "title"), currency: text(row, "currency"), saleQuantity: number(row, "saleNum"),
              fbaQuantity: number(row, "saleNumFba"), fbmQuantity: number(row, "saleNumFbm"),
              saleRevenue: number(row, "salePrice"), grossProfit: number(row, "profit"), grossProfitRate: number(row, "profitRate"),
              adCost: number(row, "adTotalCost"), refundRate: number(row, "refundPercent"), payload: row as Prisma.InputJsonValue, syncedAt: now, updatedAt: now,
            };
            await tx.sellfoxProductDailySnapshot.upsert({
              where: { storeId_reportDate_sourceKey: { storeId: store.id, reportDate, sourceKey } },
              create: { id: `sellfox-product-daily-${store.id}-${reportDate}-${sourceKey}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate, sourceKey, ...data },
              update: data,
            });
          }
          await input.onProgress?.({ reportDate, synced: syncedCount(nextCheckpoint), checkpoint: nextCheckpoint }, tx);
        });
        checkpoint = nextCheckpoint;
        if (nextPage === null) break;
        pageNo = nextPage;
      }
    } catch (error) {
      failedStores.push(store.externalId);
      checkpoint = { stores: { ...checkpoint.stores, [store.externalId]: {
        pageNo, done: false, synced: checkpoint.stores[store.externalId]?.synced ?? 0, ...sellfoxStoreFailure(error),
      } } };
      await input.onProgress?.({ reportDate, synced: syncedCount(checkpoint), checkpoint });
    }
  }
  if (failedStores.length) {
    throw new SellfoxStoreSyncError(`${failedStores.length} 个店铺产品表现同步失败，已继续处理其他店铺。`, failedStores.some((id) => checkpoint.stores[id].retryable));
  }
  return { reportDate, storeCount: stores.length, synced: syncedCount(checkpoint), failedStores };
}
