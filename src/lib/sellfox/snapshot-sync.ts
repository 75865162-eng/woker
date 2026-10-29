import { inventoryNarrow } from "./narrow-contracts";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "@/lib/sellfox/client";
import { SellfoxSyncInputError, nextSellfoxPage } from "@/lib/sellfox/sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "@/lib/sellfox/sync-errors";
import { sellfoxInventoryRequest, sellfoxSalesRequest } from "@/lib/sellfox/sync-requests";
import { sellfoxInventoryRow, sellfoxSalesRow, sellfoxSnapshotPage } from "@/lib/sellfox/snapshot-contracts";

type Metric = "inventory" | "productNum" | "salePrice" | "orderNum";
type PageState = { pageNo: number; done: boolean; writes: number; error?: string; retryable?: boolean };
export type SnapshotCheckpoint = { stores: Record<string, Partial<Record<Metric, PageState>>> };
type Dependencies = { db: Pick<PrismaClient, "sellfoxStore" | "$transaction">; post: typeof sellfoxPost };
export async function syncSellfoxSnapshotStores(input: {
  resource: "inventory" | "sales"; organizationId: string; workspaceId: string; shopExternalIds: string[];
  reportDate: string; capturedAt: string; checkpoint?: SnapshotCheckpoint;
  onProgress: (progress: { checkpoint: SnapshotCheckpoint; count: number }, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies: Dependencies = { db: prisma, post: sellfoxPost }) {
  if (!input.shopExternalIds.length || !Number.isFinite(Date.parse(input.capturedAt))) throw new SellfoxSyncInputError("快照任务缺少已冻结店铺或采集时间。");
  const stores = await dependencies.db.sellfoxStore.findMany({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } }, orderBy: { externalId: "asc" } });
  if (stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("快照任务店铺已不属于当前工作区。");
  let checkpoint: SnapshotCheckpoint = { stores: { ...input.checkpoint?.stores } };
  const metrics: Metric[] = input.resource === "inventory" ? ["inventory"] : ["productNum", "salePrice", "orderNum"];
  const count = (state: SnapshotCheckpoint) => Object.values(state.stores).reduce((sum, store) => sum + Object.values(store).reduce((total, metric) => total + (metric?.writes ?? 0), 0), 0);
  const failures: boolean[] = [];
  for (const store of stores) {
    for (const metric of metrics) {
      const previous = checkpoint.stores[store.externalId]?.[metric]; let pageNo = previous?.pageNo ?? 1;
      try {
        if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10000 || (previous && (!Number.isSafeInteger(previous.writes) || previous.writes < 0))) throw new SellfoxSyncInputError("快照分页断点无效。");
        if (previous?.done) continue;
        while (true) {
          const payload = metric === "inventory"
            ? await dependencies.post<unknown>("/api/inventoryManage/fba/pageList.json", sellfoxInventoryRequest(store.externalId, pageNo))
            : await dependencies.post<unknown>("/api/productSale/page.json", sellfoxSalesRequest(store.externalId, input.reportDate, pageNo, metric));
          const page = sellfoxSnapshotPage(payload, pageNo);
          const parsed = page.rows.map((row) => metric === "inventory" ? sellfoxInventoryRow(row, store.externalId) : sellfoxSalesRow(row, store.externalId, input.reportDate, metric));
          if (new Set(parsed.map((row) => row.sourceKey)).size !== parsed.length) throw new SellfoxSyncInputError("快照同页出现重复业务键，已拒绝写入。");
          const next = nextSellfoxPage(parsed.length, pageNo, page.totalPages);
          const nextState: SnapshotCheckpoint = { stores: { ...checkpoint.stores, [store.externalId]: { ...checkpoint.stores[store.externalId], [metric]: { pageNo: next ?? pageNo, done: next === null, writes: (checkpoint.stores[store.externalId]?.[metric]?.writes ?? 0) + parsed.length } } } };
          const capturedAt = new Date(input.capturedAt);
          await dependencies.db.$transaction(async (tx) => {
            for (const row of parsed) {
              const common = { sku: row.sku, msku: row.msku, asin: row.asin, syncedAt: capturedAt, updatedAt: new Date() };
              if ("quantity" in row) {
                const data = { ...common, fnsku: row.fnsku, quantity: row.quantity, ...inventoryNarrow(row.payload), payload: row.payload as Prisma.InputJsonValue };
                await tx.sellfoxFbaInventorySnapshot.upsert({ where: { storeId_capturedAt_sourceKey: { storeId: store.id, capturedAt, sourceKey: row.sourceKey } }, create: { id: `sellfox-inventory-${store.id}-${capturedAt.getTime()}-${row.sourceKey}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, capturedAt, reportDate: input.reportDate, sourceKey: row.sourceKey, ...data }, update: data });
              } else {
                const where = { storeId_reportDate_sourceKey: { storeId: store.id, reportDate: input.reportDate, sourceKey: row.sourceKey } };
                const existing = await tx.sellfoxSalesDailySnapshot.findUnique({ where, select: { payload: true, currency: true, asin: true, syncedAt: true } });
                const sameBatch = existing?.syncedAt?.getTime() === capturedAt.getTime();
                const oldPayload = sameBatch && existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload) ? existing.payload : {};
                if (sameBatch && existing && (existing.currency !== row.currency || (existing.asin && row.asin && existing.asin !== row.asin))) throw new SellfoxSyncInputError("销量指标的币种或 ASIN 不一致，已停止合并。");
                const data = { ...common, currency: row.currency, ...(!sameBatch ? { quantity: null, revenue: null, orders: null } : {}), ...{ [metric === "productNum" ? "quantity" : metric === "salePrice" ? "revenue" : "orders"]: row.value }, payload: { ...oldPayload, [metric]: row.payload } as Prisma.InputJsonValue };
                await tx.sellfoxSalesDailySnapshot.upsert({ where, create: { id: `sellfox-sales-${store.id}-${input.reportDate}-${row.sourceKey}`, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate: input.reportDate, sourceKey: row.sourceKey, ...data }, update: data });
              }
            }
            if (metric === "inventory" && next === null) {
              await tx.sellfoxSnapshotHead.upsert({ where: { storeId_resource: { storeId: store.id, resource: "inventory" } }, create: { storeId: store.id, resource: "inventory", capturedAt }, update: { capturedAt } });
            }
            await input.onProgress({ checkpoint: nextState, count: count(nextState) }, tx);
          });
          checkpoint = nextState;
          if (next === null) break;
          pageNo = next;
        }
      } catch (error) {
        const failure = sellfoxStoreFailure(error); failures.push(failure.retryable);
        checkpoint = { stores: { ...checkpoint.stores, [store.externalId]: { ...checkpoint.stores[store.externalId], [metric]: { pageNo, done: false, writes: checkpoint.stores[store.externalId]?.[metric]?.writes ?? 0, ...failure } } } };
        await input.onProgress({ checkpoint, count: count(checkpoint) });
      }
    }
    if (input.resource === "sales" && metrics.every((metric) => checkpoint.stores[store.externalId]?.[metric]?.done)) {
      await dependencies.db.$transaction(async (tx) => {
        const capturedAt = new Date(input.capturedAt);
        const rowWrites = metrics.reduce((n, metric) => n + (checkpoint.stores[store.externalId]?.[metric]?.writes ?? 0), 0);
        await tx.sellfoxSalesDailySnapshot.deleteMany({ where: { storeId: store.id, reportDate: input.reportDate, syncedAt: { not: capturedAt } } });
        await tx.sellfoxSalesDayCoverage.upsert({ where: { storeId_reportDate: { storeId: store.id, reportDate: input.reportDate } }, create: { storeId: store.id, reportDate: input.reportDate, capturedAt, rowWrites }, update: { capturedAt, rowWrites } });
        await input.onProgress({ checkpoint, count: count(checkpoint) }, tx);
      });
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺/指标快照单元失败，已继续处理其余单元。`, failures.some(Boolean));
  return { reportDate: input.reportDate, storeCount: stores.length, writes: count(checkpoint) };
}
