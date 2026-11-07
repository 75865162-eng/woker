import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "./client";
import { sellfoxOrderLines } from "./order-contract";
import { sellfoxSnapshotPage } from "./snapshot-contracts";
import { nextSellfoxPage, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";

export type OrderCheckpoint = Record<string, { pageNo: number; done: boolean; count: number; error?: string }>;

function lineId(storeId: string, orderId: string, lineKey: string) {
  return createHash("sha256").update(JSON.stringify(["sellfox-order", storeId, orderId, lineKey])).digest("hex");
}

export async function syncSellfoxOrders(input: {
  organizationId: string;
  workspaceId: string;
  shopExternalIds: string[];
  startDate: string;
  endDate: string;
  capturedAt: string;
  checkpoint?: OrderCheckpoint;
  onProgress: (checkpoint: OrderCheckpoint, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost }) {
  const stores = await dependencies.db.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } },
    orderBy: { externalId: "asc" },
  });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("订单店铺范围无效。");
  const capturedAt = new Date(input.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new SellfoxSyncInputError("订单采集时间无效。");
  const checkpoint: OrderCheckpoint = { ...input.checkpoint };
  const failures: boolean[] = [];
  for (const store of stores) {
    if (checkpoint[store.externalId]?.done) continue;
    let pageNo = checkpoint[store.externalId]?.pageNo ?? 1;
    try {
      if (!Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > 10000) throw new SellfoxSyncInputError("订单断点无效。");
      while (true) {
        const page = sellfoxSnapshotPage(await dependencies.post("/api/order/pageList.json", {
          shopIdList: [store.externalId],
          dateType: "purchase",
          dateStart: `${input.startDate} 00:00:00`,
          dateEnd: `${input.endDate} 23:59:59`,
          pageNo: String(pageNo),
          pageSize: "100",
        }), pageNo);
        const lines = page.rows.flatMap((row) => sellfoxOrderLines(row, store.externalId));
        if (new Set(lines.map((line) => `${line.orderId}\u0000${line.lineKey}`)).size !== lines.length) throw new SellfoxSyncInputError("订单同页重复身份。");
        const next = nextSellfoxPage(page.rows.length, pageNo, page.totalPages);
        const state: OrderCheckpoint = { ...checkpoint, [store.externalId]: { pageNo: next ?? pageNo, done: next === null, count: (checkpoint[store.externalId]?.count ?? 0) + lines.length } };
        await dependencies.db.$transaction(async (tx) => {
          for (const line of lines) {
            const data = {
              shopExternalId: store.externalId,
              sellerOrderId: line.sellerOrderId,
              asin: line.asin,
              msku: line.msku,
              sku: line.sku,
              orderStatus: line.orderStatus,
              purchaseDate: line.purchaseDate,
              purchaseDateRaw: line.purchaseDateRaw,
              payAt: line.payAt,
              refundAt: line.refundAt,
              currency: line.currency,
              orderTotal: line.orderTotal,
              qty: line.qty,
              refundQty: line.refundQty,
              itemAmount: line.itemAmount,
              revenue: line.revenue,
              promo: line.promo,
              shipServiceLevel: line.shipServiceLevel,
              fulfillmentChannel: line.fulfillmentChannel,
              address: line.address === null ? Prisma.JsonNull : line.address,
              latestCapturedAt: capturedAt,
              payload: line.payload,
              updatedAt: new Date(),
            };
            await tx.sellfoxOrderSnapshot.upsert({
              where: { storeId_orderId_lineKey: { storeId: store.id, orderId: line.orderId, lineKey: line.lineKey } },
              create: { id: lineId(store.id, line.orderId, line.lineKey), organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, orderId: line.orderId, lineKey: line.lineKey, ...data },
              update: data,
            });
          }
          if (next === null) await tx.sellfoxSnapshotHead.upsert({
            where: { storeId_resource: { storeId: store.id, resource: "orders" } },
            create: { storeId: store.id, resource: "orders", capturedAt },
            update: { capturedAt },
          });
          await input.onProgress(state, tx);
        });
        Object.assign(checkpoint, state);
        if (next === null) break;
        pageNo = next;
      }
    } catch (error) {
      const failure = sellfoxStoreFailure(error);
      failures.push(failure.retryable);
      checkpoint[store.externalId] = { pageNo, done: false, count: checkpoint[store.externalId]?.count ?? 0, error: failure.error };
      await input.onProgress(checkpoint);
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺订单采集失败，其余店铺已继续。`, failures.some(Boolean));
  return { count: Object.values(checkpoint).reduce((total, row) => total + row.count, 0), storeCount: stores.length, startDate: input.startDate, endDate: input.endDate };
}
