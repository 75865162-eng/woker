import { prisma } from "@/lib/db/prisma";
import {
  invalidateProductListCaches,
  pruneExpiredProductListResponseCaches,
} from "@/lib/products/product-list-cache";
import { refreshProductListSummaryBundle } from "@/lib/products/product-list-summary";
import { lockProductRecordForProjection, projectProductRecord } from "@/lib/products/product-projection";
import {
  markProductProjectionsProcessing,
  markProductProjectionsReady,
} from "@/lib/products/product-projection-state";

const defaultBatchSize = 100;

export async function repairProductProjections(input?: { batchSize?: number }) {
  const batchSize = Math.min(Math.max(input?.batchSize ?? defaultBatchSize, 1), 500);
  let cursor: string | undefined;
  let repaired = 0;

  while (true) {
    const records = await prisma.productRecord.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        organizationId: true,
        workspaceId: true,
        accountId: true,
        marketplace: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        payload: true,
      },
    });

    if (!records.length) break;

    await prisma.$transaction(async (tx) => {
      for (const record of records) {
        const currentRecord = await lockProductRecordForProjection(tx, {
          id: record.id,
          organizationId: record.organizationId,
          workspaceId: record.workspaceId,
        });
        await markProductProjectionsProcessing(tx, {
          productRecordId: currentRecord.id,
          organizationId: currentRecord.organizationId,
          workspaceId: currentRecord.workspaceId,
          sourceRevision: currentRecord.revision,
          attempt: 0,
        });
        await projectProductRecord(tx, currentRecord);
        await markProductProjectionsReady(tx, {
          productRecordId: currentRecord.id,
          organizationId: currentRecord.organizationId,
          workspaceId: currentRecord.workspaceId,
          sourceRevision: currentRecord.revision,
          projectionNames: ["summary", "text", "product_center"],
        });
      }
    });
    repaired += records.length;

    cursor = records[records.length - 1]?.id;
    console.log(`[products] repaired projections: ${repaired}`);
  }

  const scopes = await prisma.productRecord.findMany({
    distinct: ["organizationId", "workspaceId"],
    select: {
      organizationId: true,
      workspaceId: true,
    },
    orderBy: [{ organizationId: "asc" }, { workspaceId: "asc" }],
  });

  for (const scope of scopes) {
    await refreshProductListSummaryBundle(scope);
    const records = await prisma.productRecord.findMany({
      where: scope,
      select: { id: true, revision: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const record of records) {
        await markProductProjectionsReady(tx, {
          productRecordId: record.id,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          sourceRevision: record.revision,
          projectionNames: ["list_summary"],
        });
      }
    });
    await invalidateProductListCaches(`${scope.organizationId}:${scope.workspaceId}:`);
  }

  await pruneExpiredProductListResponseCaches();
  return { repaired, scopes: scopes.length };
}
