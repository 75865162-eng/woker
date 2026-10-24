import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "./client";
import { sellfoxSnapshotPage } from "./snapshot-contracts";
import { listingNarrow } from "./narrow-contracts";
import { nextSellfoxPage, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";
export type ListingCheckpoint = Record<string, { pageNo: number; done: boolean; count: number; error?: string }>;
export async function syncSellfoxListings(input: {
  organizationId: string; workspaceId: string; shopExternalIds: string[]; capturedAt: string;
  checkpoint?: ListingCheckpoint; onProgress: (checkpoint: ListingCheckpoint, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost }) {
  const stores = await dependencies.db.sellfoxStore.findMany({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } }, orderBy: { externalId: "asc" } });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("Listing 店铺范围无效。");
  const checkpoint: ListingCheckpoint = { ...input.checkpoint }; const failures: boolean[] = [];
  const capturedAt = new Date(input.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new SellfoxSyncInputError("Listing 采集时间无效。");
  for (const store of stores) {
    if (checkpoint[store.externalId]?.done) continue;
    let pageNo = checkpoint[store.externalId]?.pageNo ?? 1;
    try {
      if (!Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > 10000) throw new SellfoxSyncInputError("Listing 断点无效。");
      while (true) {
        const page = sellfoxSnapshotPage(await dependencies.post("/api/order/api/product/v2/pageList.json", { shopIdList: [store.externalId], pageNo: String(pageNo), pageSize: "100" }), pageNo);
        const rows = page.rows.map((row) => ({ ...listingNarrow(row, store.externalId), payload: row as Prisma.InputJsonValue }));
        if (new Set(rows.map((row) => row.sourceKey)).size !== rows.length) throw new SellfoxSyncInputError("Listing 同页重复身份。");
        const next = nextSellfoxPage(rows.length, pageNo, page.totalPages);
        const state = { ...checkpoint, [store.externalId]: { pageNo: next ?? pageNo, done: next === null, count: (checkpoint[store.externalId]?.count ?? 0) + rows.length } };
        await dependencies.db.$transaction(async (tx) => {
          for (const row of rows) {
            const id = createHash("sha256").update(JSON.stringify([store.id, input.capturedAt, row.sourceKey])).digest("hex");
            await tx.sellfoxListingSnapshot.upsert({ where: { storeId_capturedAt_sourceKey: { storeId: store.id, capturedAt, sourceKey: row.sourceKey } }, create: { id, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, capturedAt, ...row }, update: row });
          }
          if (next === null) await tx.sellfoxSnapshotHead.upsert({ where: { storeId_resource: { storeId: store.id, resource: "listings" } }, create: { storeId: store.id, resource: "listings", capturedAt }, update: { capturedAt } });
          await input.onProgress(state, tx);
        });
        Object.assign(checkpoint, state);
        if (next === null) break;
        pageNo = next;
      }
    } catch (error) {
      const failure = sellfoxStoreFailure(error); failures.push(failure.retryable);
      checkpoint[store.externalId] = { pageNo, done: false, count: checkpoint[store.externalId]?.count ?? 0, error: failure.error };
      await input.onProgress(checkpoint);
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺 Listing 采集失败，其余店铺已继续。`, failures.some(Boolean));
  return { count: Object.values(checkpoint).reduce((n, row) => n + row.count, 0), storeCount: stores.length };
}
