import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "./client";
import { sellfoxOrderDetailRow, sellfoxOrderDetailRows } from "./order-detail-contract";
import { SellfoxSyncInputError } from "./sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";

/**
 * 订单详情批量同步器。
 * 接口 /api/order/detailByOrderIds.json 支持按「店铺 + amazonOrderId 或 sellerOrderId（最多200个）」查详情，
 * 二者都填时按 amazonOrderId 搜索。订单列表接口只回带 amazonOrderId（快照的 orderId 列），
 * 快照的 sellerOrderId 列在真实数据里为 null，因此以 orderId（即 amazonOrderId）为驱动源：
 * 按店铺取 distinct orderId，排序后每 200 个一批，用 amazonOrderId 参数回填详情到 SellfoxOrderDetail。
 * 断点按店铺记录已处理的订单游标（processed），进程回收后可续跑；upsert 幂等。
 */
export type OrderDetailCheckpoint = Record<string, { processed: number; done: boolean; count: number; error?: string }>;

const BATCH_SIZE = 200;

function detailId(storeId: string, sellerOrderId: string) {
  return createHash("sha256").update(JSON.stringify(["sellfox-order-detail", storeId, sellerOrderId])).digest("hex");
}

export async function syncSellfoxOrderDetail(input: {
  organizationId: string;
  workspaceId: string;
  shopExternalIds: string[];
  capturedAt: string;
  checkpoint?: OrderDetailCheckpoint;
  onProgress: (checkpoint: OrderDetailCheckpoint, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost }) {
  const stores = await dependencies.db.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } },
    orderBy: { externalId: "asc" },
  });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("订单详情店铺范围无效。");
  const capturedAt = new Date(input.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new SellfoxSyncInputError("订单详情采集时间无效。");
  const checkpoint: OrderDetailCheckpoint = { ...input.checkpoint };
  const failures: boolean[] = [];

  for (const store of stores) {
    if (checkpoint[store.externalId]?.done) continue;
    let processed = checkpoint[store.externalId]?.processed ?? 0;
    let written = checkpoint[store.externalId]?.count ?? 0;
    try {
      if (!Number.isSafeInteger(processed) || processed < 0) throw new SellfoxSyncInputError("订单详情断点无效。");
      // 驱动源：订单快照里该店铺的 distinct orderId（= amazonOrderId，行级快照需去重）。
      // 不使用 sellerOrderId 列：订单列表接口不回带该字段，真实数据里恒为 null。
      const orderRows = await dependencies.db.sellfoxOrderSnapshot.findMany({
        where: { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id },
        select: { orderId: true },
        distinct: ["orderId"],
        orderBy: { orderId: "asc" },
      });
      const ids = Array.from(new Set(orderRows.map((row) => row.orderId as string).filter(Boolean))).sort();
      if (processed > ids.length) throw new SellfoxSyncInputError("订单详情断点超过订单总数。");
      while (processed < ids.length) {
        const batch = ids.slice(processed, processed + BATCH_SIZE);
        // 文档：amazonOrderId 与 sellerOrderId 二选一，都填按 amazonOrderId 搜索。
        const payload = await dependencies.post<unknown>("/api/order/detailByOrderIds.json", {
          shopId: store.externalId,
          amazonOrderId: batch.join(","),
        });
        const details = sellfoxOrderDetailRows(payload);
        await dependencies.db.$transaction(async (tx) => {
          for (const value of details) {
            const row = sellfoxOrderDetailRow(value, store.externalId);
            const data = {
              shopExternalId: store.externalId,
              sellerOrderId: row.sellerOrderId,
              amazonOrderId: row.amazonOrderId,
              orderStatus: row.orderStatus,
              orderTotalCurrency: row.orderTotalCurrency,
              orderTotalAmount: row.orderTotalAmount,
              marketplaceId: row.marketplaceId,
              orderType: row.orderType,
              purchaseDate: row.purchaseDate,
              paymentsDate: row.paymentsDate,
              refundDate: row.refundDate,
              fulfillmentChannel: row.fulfillmentChannel,
              settlementStatus: row.settlementStatus,
              refundStatus: row.refundStatus,
              productAmount: row.productAmount,
              refundPrice: row.refundPrice,
              fbaPerUnitFulfillmentFee: row.fbaPerUnitFulfillmentFee,
              commission: row.commission,
              otherAmount: row.otherAmount,
              purchaseCost: row.purchaseCost,
              headTripCost: row.headTripCost,
              fbmShipCost: row.fbmShipCost,
              orderProfit: row.orderProfit,
              totalCost: row.totalCost,
              totalRevenue: row.totalRevenue,
              shippingCharge: row.shippingCharge,
              promotionDiscount: row.promotionDiscount,
              taxAmount: row.taxAmount,
              isBusinessOrder: row.isBusinessOrder,
              isReturnOrder: row.isReturnOrder,
              payload: row.payload,
              latestCapturedAt: capturedAt,
              updatedAt: new Date(),
            };
            await tx.sellfoxOrderDetail.upsert({
              where: { storeId_sellerOrderId: { storeId: store.id, sellerOrderId: row.sellerOrderId } },
              create: { id: detailId(store.id, row.sellerOrderId), organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, ...data },
              update: data,
            });
          }
          processed += batch.length;
          written += details.length;
          const state: OrderDetailCheckpoint = { ...checkpoint, [store.externalId]: { processed, done: processed >= ids.length, count: written } };
          await input.onProgress(state, tx);
          Object.assign(checkpoint, state);
        });
      }
      checkpoint[store.externalId] = { processed, done: true, count: written };
      await input.onProgress(checkpoint);
    } catch (error) {
      const failure = sellfoxStoreFailure(error);
      failures.push(failure.retryable);
      checkpoint[store.externalId] = { processed, done: false, count: written, error: failure.error };
      await input.onProgress(checkpoint);
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺订单详情采集失败，其余店铺已继续。`, failures.some(Boolean));
  return { count: Object.values(checkpoint).reduce((total, row) => total + row.count, 0), storeCount: stores.length };
}
