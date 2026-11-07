import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "./client";
import { sellfoxFbaShipmentLines } from "./fba-shipment-contract";
import { sellfoxSnapshotPage } from "./snapshot-contracts";
import { nextSellfoxPage, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";

export type FbaShipmentCheckpoint = Record<string, { pageNo: number; done: boolean; count: number; error?: string }>;

function lineId(storeId: string, shipmentId: string, lineKey: string) {
  return createHash("sha256").update(JSON.stringify(["sellfox-fba-shipment", storeId, shipmentId, lineKey])).digest("hex");
}

export async function syncSellfoxFbaShipments(input: {
  organizationId: string;
  workspaceId: string;
  shopExternalIds: string[];
  startDate?: string;
  endDate?: string;
  capturedAt: string;
  checkpoint?: FbaShipmentCheckpoint;
  onProgress: (checkpoint: FbaShipmentCheckpoint, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost }) {
  const stores = await dependencies.db.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } },
    orderBy: { externalId: "asc" },
  });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("FBA 货件店铺范围无效。");
  const capturedAt = new Date(input.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new SellfoxSyncInputError("FBA 货件采集时间无效。");
  const checkpoint: FbaShipmentCheckpoint = { ...input.checkpoint };
  const failures: boolean[] = [];
  for (const store of stores) {
    if (checkpoint[store.externalId]?.done) continue;
    let pageNo = checkpoint[store.externalId]?.pageNo ?? 1;
    try {
      if (!Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > 10000) throw new SellfoxSyncInputError("FBA 货件断点无效。");
      while (true) {
        const page = sellfoxSnapshotPage(await dependencies.post("/api/fba/shippingOrder/pageList.json", {
          shopIds: [store.externalId],
          pageNo: String(pageNo),
          pageSize: "100",
          ...(input.startDate && input.endDate ? { createTimeStart: input.startDate, createTimeEnd: input.endDate } : {}),
        }), pageNo);
        const lines = page.rows.flatMap((row) => sellfoxFbaShipmentLines(row, store.externalId));
        if (new Set(lines.map((line) => `${line.shipmentId}\u0000${line.lineKey}`)).size !== lines.length) throw new SellfoxSyncInputError("货件同页重复身份。");
        const next = nextSellfoxPage(page.rows.length, pageNo, page.totalPages);
        const state: FbaShipmentCheckpoint = { ...checkpoint, [store.externalId]: { pageNo: next ?? pageNo, done: next === null, count: (checkpoint[store.externalId]?.count ?? 0) + lines.length } };
        await dependencies.db.$transaction(async (tx) => {
          for (const line of lines) {
            const data = {
              shopExternalId: store.externalId,
              shipmentName: line.shipmentName,
              status: line.status,
              asin: line.asin,
              msku: line.msku,
              sku: line.sku,
              declaredQty: line.declaredQty,
              shippedQty: line.shippedQty,
              receivedQty: line.receivedQty,
              sourceCreatedAt: line.sourceCreatedAt,
              sourceUpdatedAt: line.sourceUpdatedAt,
              shippedAt: line.shippedAt,
              fulfillmentCenterId: line.fulfillmentCenterId,
              latestCapturedAt: capturedAt,
              payload: line.payload,
              updatedAt: new Date(),
            };
            await tx.sellfoxFbaShipmentSnapshot.upsert({
              where: { storeId_shipmentId_lineKey: { storeId: store.id, shipmentId: line.shipmentId, lineKey: line.lineKey } },
              create: { id: lineId(store.id, line.shipmentId, line.lineKey), organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, shipmentId: line.shipmentId, lineKey: line.lineKey, ...data },
              update: data,
            });
          }
          if (next === null) {
            await tx.sellfoxFbaShipmentSnapshot.deleteMany({ where: { storeId: store.id, latestCapturedAt: { not: capturedAt } } });
            await tx.sellfoxSnapshotHead.upsert({
              where: { storeId_resource: { storeId: store.id, resource: "fba_shipments" } },
              create: { storeId: store.id, resource: "fba_shipments", capturedAt },
              update: { capturedAt },
            });
          }
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
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺 FBA 货件采集失败，其余店铺已继续。`, failures.some(Boolean));
  return { count: Object.values(checkpoint).reduce((total, row) => total + row.count, 0), storeCount: stores.length };
}
